import _JSXStyle from "next/dist/shared/lib/styled-jsx";
import colors, { size } from './constants';
const color = 'red';
const bar = new String("div.jsx-aaed0341accea8f{font-size:3em}");
bar.__hash = "aaed0341accea8f";
const baz = new String("div{font-size:3em}");
baz.__hash = "aaed0341accea8f";
const a = new String(`div{font-size:${size}em}`);
a.__hash = "b6966e11ccb637f2";
export const uh = bar;
export const foo = new String(`div.jsx-dbfc29cedbb5f49b{color:${color}}`);
foo.__hash = "dbfc29cedbb5f49b";
({
    styles: <_JSXStyle id={"38ae14c4ec5e0907"}>{`div.jsx-38ae14c4ec5e0907{color:${colors.green.light}}a.jsx-38ae14c4ec5e0907{color:red}`}</_JSXStyle>,
    className: "jsx-38ae14c4ec5e0907"
});
const b = {
    styles: <_JSXStyle id={"38ae14c4ec5e0907"}>{`div.jsx-38ae14c4ec5e0907{color:${colors.green.light}}a.jsx-38ae14c4ec5e0907{color:red}`}</_JSXStyle>,
    className: "jsx-38ae14c4ec5e0907"
};
const dynamic = (colors)=>{
    const b = {
        styles: <_JSXStyle id={"b68d3b38146e2a7d"} dynamic={[
            colors.green.light
        ]}>{`div.__jsx-style-dynamic-selector{color:${colors.green.light}}a.__jsx-style-dynamic-selector{color:red}`}</_JSXStyle>,
        className: _JSXStyle.dynamic([
            [
                "b68d3b38146e2a7d",
                [
                    colors.green.light
                ]
            ]
        ])
    };
};
export default {
    styles: <_JSXStyle id={"a300397bb1f6c7cd"}>{`div.jsx-a300397bb1f6c7cd{font-size:3em}p.jsx-a300397bb1f6c7cd{color:${color}}`}</_JSXStyle>,
    className: "jsx-a300397bb1f6c7cd"
};
