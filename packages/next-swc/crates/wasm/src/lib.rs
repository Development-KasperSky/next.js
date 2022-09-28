use anyhow::{Context, Error};
use js_sys::JsString;
use next_swc::{custom_before_pass, TransformOptions};
use once_cell::sync::Lazy;
use std::sync::Arc;
use wasm_bindgen::{prelude::*, JsCast};
use wasm_bindgen_futures::future_to_promise;

use swc_core::{
    base::{config::JsMinifyOptions, config::ParseOptions, try_with_handler, Compiler},
    common::{comments::Comments, errors::ColorConfig, FileName, FilePathMapping, SourceMap},
    ecma::transforms::base::pass::noop,
};

fn convert_err(err: Error) -> JsValue {
    format!("{:?}", err).into()
}

#[wasm_bindgen(js_name = "minifySync")]
pub fn minify_sync(s: JsString, opts: JsValue) -> Result<JsValue, JsValue> {
    console_error_panic_hook::set_once();

    let c = compiler();

    try_with_handler(
        c.cm.clone(),
        swc_core::base::HandlerOpts {
            color: ColorConfig::Never,
            skip_filename: false,
        },
        |handler| {
            let opts: JsMinifyOptions = opts.into_serde().context("failed to parse options")?;

            let fm = c.cm.new_source_file(FileName::Anon, s.into());
            let program = c
                .minify(fm, handler, &opts)
                .context("failed to minify file")?;

            JsValue::from_serde(&program).context("failed to serialize json")
        },
    )
    .map_err(convert_err)
}

#[wasm_bindgen(js_name = "minify")]
pub fn minify(s: JsString, opts: JsValue) -> js_sys::Promise {
    // TODO: This'll be properly scheduled once wasm have standard backed thread
    // support.
    future_to_promise(async { minify_sync(s, opts) })
}

#[wasm_bindgen(js_name = "transformSync")]
pub fn transform_sync(s: JsValue, opts: JsValue) -> Result<JsValue, JsValue> {
    console_error_panic_hook::set_once();

    let c = compiler();

    try_with_handler(
        c.cm.clone(),
        swc_core::base::HandlerOpts {
            color: ColorConfig::Never,
            skip_filename: false,
        },
        |handler| {
            let opts: TransformOptions = opts.into_serde().context("failed to parse options")?;

            let s = s.dyn_into::<js_sys::JsString>();
            let out = match s {
                Ok(s) => {
                    let fm = c.cm.new_source_file(
                        if opts.swc.filename.is_empty() {
                            FileName::Anon
                        } else {
                            FileName::Real(opts.swc.filename.clone().into())
                        },
                        s.into(),
                    );
                    let cm = c.cm.clone();
                    let file = fm.clone();
                    c.process_js_with_custom_pass(
                        fm,
                        None,
                        handler,
                        &opts.swc,
                        |_, comments| {
                            custom_before_pass(
                                cm,
                                file,
                                &opts,
                                comments.clone(),
                                Default::default(),
                            )
                        },
                        |_, _| noop(),
                    )
                    .context("failed to process js file")?
                }
                Err(v) => c.process_js(handler, v.into_serde().expect(""), &opts.swc)?,
            };

            JsValue::from_serde(&out).context("failed to serialize json")
        },
    )
    .map_err(convert_err)
}

#[wasm_bindgen(js_name = "transform")]
pub fn transform(s: JsValue, opts: JsValue) -> js_sys::Promise {
    // TODO: This'll be properly scheduled once wasm have standard backed thread
    // support.
    future_to_promise(async { transform_sync(s, opts) })
}

#[wasm_bindgen(js_name = "parseSync")]
pub fn parse_sync(s: JsString, opts: JsValue) -> Result<JsValue, JsValue> {
    console_error_panic_hook::set_once();

    let c = swc_core::base::Compiler::new(Arc::new(SourceMap::new(FilePathMapping::empty())));

    try_with_handler(
        c.cm.clone(),
        swc_core::base::HandlerOpts {
            ..Default::default()
        },
        |handler| {
            c.run(|| {
                let opts: ParseOptions = opts.into_serde().context("failed to parse options")?;

                let fm = c.cm.new_source_file(FileName::Anon, s.into());

                let cmts = c.comments().clone();
                let comments = if opts.comments {
                    Some(&cmts as &dyn Comments)
                } else {
                    None
                };

                let program = c
                    .parse_js(
                        fm,
                        handler,
                        opts.target,
                        opts.syntax,
                        opts.is_module,
                        comments,
                    )
                    .context("failed to parse code")?;

                let s = serde_json::to_string(&program).unwrap();
                Ok(JsValue::from_str(&s))
            })
        },
    )
    .map_err(convert_err)
}

#[wasm_bindgen(js_name = "parse")]
pub fn parse(s: JsString, opts: JsValue) -> js_sys::Promise {
    // TODO: This'll be properly scheduled once wasm have standard backed thread
    // support.
    future_to_promise(async { parse_sync(s, opts) })
}

/// Get global sourcemap
fn compiler() -> Arc<Compiler> {
    static C: Lazy<Arc<Compiler>> = Lazy::new(|| {
        let cm = Arc::new(SourceMap::new(FilePathMapping::empty()));

        Arc::new(Compiler::new(cm))
    });

    C.clone()
}
