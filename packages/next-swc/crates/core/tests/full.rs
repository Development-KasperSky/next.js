use next_swc::{custom_before_pass, TransformOptions};
use serde::de::DeserializeOwned;
use std::path::{Path, PathBuf};
use swc_core::{
    base::Compiler,
    ecma::parser::{Syntax, TsConfig},
    ecma::transforms::base::pass::noop,
};
use testing::{NormalizedOutput, Tester};

#[testing::fixture("tests/full/**/input.js")]
fn full(input: PathBuf) {
    test(&input, true);
}

#[testing::fixture("tests/loader/**/input.js")]
fn loader(input: PathBuf) {
    test(&input, false);
}

fn test(input: &Path, minify: bool) {
    let output = input.parent().unwrap().join("output.js");

    Tester::new()
        .print_errors(|cm, handler| {
            let c = Compiler::new(cm.clone());

            let fm = cm.load_file(input).expect("failed to load file");

            let options = TransformOptions {
                swc: swc_core::base::config::Options {
                    swcrc: true,
                    output_path: Some(output.clone()),

                    config: swc_core::base::config::Config {
                        is_module: swc_core::base::config::IsModule::Bool(true),

                        jsc: swc_core::base::config::JscConfig {
                            minify: if minify {
                                Some(assert_json("{ \"compress\": true, \"mangle\": true }"))
                            } else {
                                None
                            },
                            syntax: Some(Syntax::Typescript(TsConfig {
                                tsx: true,
                                ..Default::default()
                            })),
                            ..Default::default()
                        },
                        ..Default::default()
                    },
                    ..Default::default()
                },
                disable_next_ssg: false,
                disable_page_config: false,
                pages_dir: None,
                is_page_file: false,
                is_development: true,
                is_server: false,
                styled_components: Some(assert_json("{}")),
                remove_console: None,
                react_remove_properties: None,
                relay: None,
                shake_exports: None,
                emotion: Some(assert_json("{}")),
                modularize_imports: None,
            };

            let options = options.patch(&fm);

            match c.process_js_with_custom_pass(
                fm.clone(),
                None,
                &handler,
                &options.swc,
                |_, comments| {
                    custom_before_pass(
                        cm.clone(),
                        fm.clone(),
                        &options,
                        comments.clone(),
                        Default::default(),
                    )
                },
                |_, _| noop(),
            ) {
                Ok(v) => {
                    NormalizedOutput::from(v.code)
                        .compare_to_file(output)
                        .unwrap();
                }
                Err(err) => panic!("Error: {:?}", err),
            };

            Ok(())
        })
        .map(|_| ())
        .expect("failed");
}

/// Using this, we don't have to break code by adding field.s
fn assert_json<T>(json_str: &str) -> T
where
    T: DeserializeOwned,
{
    serde_json::from_str(json_str).expect("failed to deserialize")
}
