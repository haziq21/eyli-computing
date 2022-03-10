/**
 * Functions to interface with the Windi JS API.
 * Adapted from https://github.com/windicss/windicss/blob/main/src/cli/index.ts
 */

import { Processor } from "https://esm.sh/windicss/lib";
import { HTMLParser, CSSParser } from "https://esm.sh/windicss/utils/parser";
import config from "../windi.config.ts";

const processor = new Processor(config);

function interpret(html: string) {
    let classes: string[] = [];

    const parser = new HTMLParser(html);
    classes = parser.parseClasses().map((i) => i.result);

    const utility = processor.interpret(classes.join(" "));
    const outputStyles = utility.styleSheet.extend(processor.preflight(html));

    const matchedBlock = html.match(
        /(?<=<style[\r\n]*\s*lang\s?=\s?['"]windi["']>)[\s\S]*(?=<\/style>)/
    );

    if (matchedBlock && matchedBlock.index) {
        const css = html.slice(
            matchedBlock.index,
            matchedBlock.index + matchedBlock[0].length
        );

        const parser = new CSSParser(css, processor);
        outputStyles.extend(parser.parse());
    }

    return outputStyles;
}

export function buildWindi(html: string): string {
    return interpret(html).sort().combine().build(true);
}
