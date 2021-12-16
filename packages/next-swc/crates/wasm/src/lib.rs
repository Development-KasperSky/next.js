use anyhow::{Context, Error};
use next_swc::{custom_before_pass, TransformOptions};
use once_cell::sync::Lazy;
use std::sync::Arc;
use swc::{config::JsMinifyOptions, try_with_handler, Compiler};
use swc_common::{FileName, FilePathMapping, SourceMap};
use swc_ecmascript::transforms::pass::noop;
use wasm_bindgen::prelude::*;

fn convert_err(err: Error) -> JsValue {
    format!("{:?}", err).into()
}

#[wasm_bindgen(js_name = "minifySync")]
pub fn minify_sync(s: &str, opts: JsValue) -> Result<JsValue, JsValue> {
    console_error_panic_hook::set_once();

    let c = compiler();

    try_with_handler(c.cm.clone(), false, |handler| {
        let opts: JsMinifyOptions = opts.into_serde().context("failed to parse options")?;

        let fm = c.cm.new_source_file(FileName::Anon, s.into());
        let program = c
            .minify(fm, &handler, &opts)
            .context("failed to minify file")?;

        Ok(JsValue::from_serde(&program).context("failed to serialize json")?)
    })
    .map_err(convert_err)
}

#[wasm_bindgen(js_name = "transformSync")]
pub fn transform_sync(s: &str, opts: JsValue) -> Result<JsValue, JsValue> {
    console_error_panic_hook::set_once();

    let c = compiler();

    try_with_handler(c.cm.clone(), false, |handler| {
        let opts: TransformOptions = opts.into_serde().context("failed to parse options")?;

        let fm = c.cm.new_source_file(
            if opts.swc.filename == "" {
                FileName::Anon
            } else {
                FileName::Real(opts.swc.filename.clone().into())
            },
            s.into(),
        );
        let before_pass = custom_before_pass(c.cm.clone(), fm.clone(), &opts);
        let out = c
            .process_js_with_custom_pass(fm, None, &handler, &opts.swc, |_| before_pass, |_| noop())
            .context("failed to process js file")?;

        Ok(JsValue::from_serde(&out).context("failed to serialize json")?)
    })
    .map_err(convert_err)
}

/// Get global sourcemap
fn compiler() -> Arc<Compiler> {
    static C: Lazy<Arc<Compiler>> = Lazy::new(|| {
        let cm = Arc::new(SourceMap::new(FilePathMapping::empty()));

        Arc::new(Compiler::new(cm))
    });

    C.clone()
}
