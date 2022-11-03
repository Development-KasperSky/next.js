/*
Copyright (c) 2017 The swc Project Developers

Permission is hereby granted, free of charge, to any
person obtaining a copy of this software and associated
documentation files (the "Software"), to deal in the
Software without restriction, including without
limitation the rights to use, copy, modify, merge,
publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software
is furnished to do so, subject to the following
conditions:

The above copyright notice and this permission notice
shall be included in all copies or substantial portions
of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF
ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED
TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT
SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR
IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
DEALINGS IN THE SOFTWARE.
*/

#![recursion_limit = "2048"]
#![deny(clippy::all)]
#![feature(box_patterns)]

use auto_cjs::contains_cjs;
use either::Either;
use fxhash::FxHashSet;
use serde::Deserialize;
use std::cell::RefCell;
use std::rc::Rc;
use std::{path::PathBuf, sync::Arc};

use swc_core::{
    base::config::ModuleConfig,
    common::{chain, comments::Comments, pass::Optional, FileName, SourceFile, SourceMap},
    ecma::ast::EsVersion,
    ecma::parser::parse_file_as_module,
    ecma::transforms::base::pass::noop,
    ecma::visit::Fold,
};

pub mod amp_attributes;
mod auto_cjs;
pub mod disallow_re_export_all_in_page;
pub mod next_dynamic;
pub mod next_font_loaders;
pub mod next_ssg;
pub mod page_config;
pub mod react_remove_properties;
pub mod react_server_components;
#[cfg(not(target_arch = "wasm32"))]
pub mod relay;
pub mod remove_console;
pub mod shake_exports;
mod top_level_binding_collector;

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransformOptions {
    #[serde(flatten)]
    pub swc: swc_core::base::config::Options,

    #[serde(default)]
    pub disable_next_ssg: bool,

    #[serde(default)]
    pub disable_page_config: bool,

    #[serde(default)]
    pub pages_dir: Option<PathBuf>,

    #[serde(default)]
    pub is_page_file: bool,

    #[serde(default)]
    pub is_development: bool,

    #[serde(default)]
    pub is_server: bool,

    #[serde(default)]
    pub server_components: Option<react_server_components::Config>,

    #[serde(default)]
    pub styled_jsx: bool,

    #[serde(default)]
    pub styled_components: Option<styled_components::Config>,

    #[serde(default)]
    pub remove_console: Option<remove_console::Config>,

    #[serde(default)]
    pub react_remove_properties: Option<react_remove_properties::Config>,

    #[serde(default)]
    #[cfg(not(target_arch = "wasm32"))]
    pub relay: Option<relay::Config>,

    #[allow(unused)]
    #[serde(default)]
    #[cfg(target_arch = "wasm32")]
    /// Accept any value
    pub relay: Option<serde_json::Value>,

    #[serde(default)]
    pub shake_exports: Option<shake_exports::Config>,

    #[serde(default)]
    pub emotion: Option<swc_emotion::EmotionOptions>,

    #[serde(default)]
    pub modularize_imports: Option<modularize_imports::Config>,

    #[serde(default)]
    pub font_loaders: Option<next_font_loaders::Config>,
}

pub fn custom_before_pass<'a, C: Comments + 'a>(
    cm: Arc<SourceMap>,
    file: Arc<SourceFile>,
    opts: &'a TransformOptions,
    comments: C,
    eliminated_packages: Rc<RefCell<FxHashSet<String>>>,
) -> impl Fold + 'a
where
    C: Clone,
{
    #[cfg(target_arch = "wasm32")]
    let relay_plugin = noop();

    #[cfg(not(target_arch = "wasm32"))]
    let relay_plugin = {
        if let Some(config) = &opts.relay {
            Either::Left(relay::relay(
                config,
                file.name.clone(),
                opts.pages_dir.clone(),
            ))
        } else {
            Either::Right(noop())
        }
    };

    chain!(
        disallow_re_export_all_in_page::disallow_re_export_all_in_page(opts.is_page_file),
        match &opts.server_components {
            Some(config) if config.truthy() =>
                Either::Left(react_server_components::server_components(
                    file.name.clone(),
                    config.clone(),
                    comments.clone(),
                )),
            _ => Either::Right(noop()),
        },
        if opts.styled_jsx {
            Either::Left(styled_jsx::visitor::styled_jsx(
                cm.clone(),
                file.name.clone(),
            ))
        } else {
            Either::Right(noop())
        },
        match &opts.styled_components {
            Some(config) => Either::Left(styled_components::styled_components(
                file.name.clone(),
                file.src_hash,
                config.clone(),
            )),
            None => Either::Right(noop()),
        },
        Optional::new(
            next_ssg::next_ssg(eliminated_packages),
            !opts.disable_next_ssg
        ),
        amp_attributes::amp_attributes(),
        next_dynamic::next_dynamic(
            opts.is_development,
            opts.is_server,
            opts.server_components.is_some(),
            file.name.clone(),
            opts.pages_dir.clone()
        ),
        Optional::new(
            page_config::page_config(opts.is_development, opts.is_page_file),
            !opts.disable_page_config
        ),
        relay_plugin,
        match &opts.remove_console {
            Some(config) if config.truthy() =>
                Either::Left(remove_console::remove_console(config.clone())),
            _ => Either::Right(noop()),
        },
        match &opts.react_remove_properties {
            Some(config) if config.truthy() =>
                Either::Left(react_remove_properties::remove_properties(config.clone())),
            _ => Either::Right(noop()),
        },
        match &opts.shake_exports {
            Some(config) => Either::Left(shake_exports::shake_exports(config.clone())),
            None => Either::Right(noop()),
        },
        opts.emotion
            .as_ref()
            .and_then(|config| {
                if !config.enabled.unwrap_or(false) {
                    return None;
                }
                if let FileName::Real(path) = &file.name {
                    path.to_str().map(|_| {
                        Either::Left(swc_emotion::EmotionTransformer::new(
                            config.clone(),
                            path,
                            cm,
                            comments,
                        ))
                    })
                } else {
                    None
                }
            })
            .unwrap_or_else(|| Either::Right(noop())),
        match &opts.modularize_imports {
            Some(config) => Either::Left(modularize_imports::modularize_imports(config.clone())),
            None => Either::Right(noop()),
        },
        match &opts.font_loaders {
            Some(config) => Either::Left(next_font_loaders::next_font_loaders(config.clone())),
            None => Either::Right(noop()),
        },
    )
}

impl TransformOptions {
    pub fn patch(mut self, fm: &SourceFile) -> Self {
        self.swc.swcrc = false;

        let should_enable_commonjs = self.swc.config.module.is_none()
            && (fm.src.contains("module.exports") || fm.src.contains("__esModule"))
            && {
                let syntax = self.swc.config.jsc.syntax.unwrap_or_default();
                let target = self.swc.config.jsc.target.unwrap_or_else(EsVersion::latest);

                parse_file_as_module(fm, syntax, target, None, &mut vec![])
                    .map(|m| contains_cjs(&m))
                    .unwrap_or_default()
            };

        if should_enable_commonjs {
            self.swc.config.module = Some(ModuleConfig::CommonJs(Default::default()));
        }

        self
    }
}
