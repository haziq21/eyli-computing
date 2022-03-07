import { serve } from "https://deno.land/std@0.128.0/http/server.ts";

import { Processor } from "https://esm.sh/windicss/lib";
import { HTMLParser, CSSParser } from "https://esm.sh/windicss/utils/parser";
import { StyleSheet } from "https://esm.sh/windicss/utils/style";
import config from "../windi.config.ts";

import { micromark } from "https://esm.sh/micromark";
import { gfm, gfmHtml } from "https://esm.sh/micromark-extension-gfm";

/**************        CODE FOR SITE GENERATION        **************/

/**
 * Given a HTML document containing Windi classes, output the corresponding stylesheet.
 * Taken from https://windicss.org/integrations/javascript.html.
 */
function compileWindi(html: string): { html: string; css: string } {
    // Get windi processor
    const processor = new Processor(config);

    // Parse HTML to get array of class matches with location
    const htmlParser = new HTMLParser(html);

    // Generate preflight based on the HTML we input
    const preflightSheet = processor.preflight(html);

    const PREFIX = "windi-";
    const outputCSS: StyleSheet[] = [];
    let outputHTML = "";
    let indexStart = 0;

    htmlParser.parseClasses().forEach((p) => {
        // Add HTML substring from index to match start
        outputHTML += html.substring(indexStart, p.start);

        // Generate stylesheet
        const style = processor.compile(p.result, PREFIX);

        // Add the stylesheet to the styles stack
        outputCSS.push(style.styleSheet);

        // Append ignored classes and push to output
        outputHTML += [style.className, ...style.ignored].join(" ");

        // Mark the end as our new start for next iteration
        indexStart = p.end;
    });

    // Include styles found in `<style lang="windi">` tags
    const block = html.match(
        /(<style lang=['"]windi["']>)([\s\S]*)(<\/style>)/
    )!;
    const blockStart = block.index!;
    const contentStart = blockStart + block[1].length;

    const css = html.slice(contentStart, contentStart + block[2].length);
    const cssParser = new CSSParser(css, processor);
    outputCSS.push(cssParser.parse());

    // Append the remaining HTML
    outputHTML += html.substring(indexStart, blockStart);
    outputHTML += html.substring(blockStart + block[0].length);

    // Build styles
    const MINIFY = false;
    const styles = outputCSS
        // Extend the preflight sheet with each sheet from the stack
        .reduce((acc, curr) => acc.extend(curr), preflightSheet)
        .build(MINIFY);

    return {
        css: styles,
        html: outputHTML,
    };
}

/** Return an array of all the Markdown articles in `../pages`. */
function getAvailableArticles(): string[] {
    const articles: string[] = [];

    for (const f of Deno.readDirSync("pages")) {
        if (f.name.endsWith(".md")) articles.push(f.name.slice(0, -3));
    }

    return articles;
}

/**
 * Given a Markdown document, return the HTML generated from it.
 */
function generateHtml(md: string): string {
    return micromark(md, {
        allowDangerousHtml: true,
        extensions: [gfm()],
        htmlExtensions: [gfmHtml()],
    });
}

/**
 * Given IDs for slots and their  hashmap, return  `layout.html`
 * with every `{{slot id}}` replaced by the corresponding content to hydrate.
 */
function hydrateLayout(targets: Record<string, string>): string {
    let html = Deno.readTextFileSync("src/public/layout.html");

    for (const t in targets) {
        html = html.replace(`{{${t}}}`, targets[t]);
    }

    return html;
}

/**************        CODE FOR WEB SERVER        **************/

const RESPONSE_INIT = {
    html: {
        headers: {
            "content-type": "text/html; charset=utf-8",
        },
    },
    css: {
        headers: {
            "content-type": "text/css; charset=utf-8",
        },
    },
    notFound: {
        status: 404,
        headers: {
            "content-type": "text/plain; charset=utf-8",
        },
    },
};

/** Response to the `/` route of the webapp. Writes to `globalStyleCache`. */
function index(): Response {
    const hydratedPage = hydrateLayout({
        title: "EYLI Computing",
        slot: Deno.readTextFileSync("src/public/index.html"),
        // The next article is the first article
        nextUrl: getAvailableArticles().sort()[0],
    });

    const { html, css } = compileWindi(hydratedPage);
    // Save the stylesheet
    globalStyleCache = css;

    return new Response(html, RESPONSE_INIT.html);
}

/**
 * Response to the `/<article>` route of the webapp, assuming
 * that the article exists.  Writes to `globalStyleCache`.
 */
function article(articleId: string): Response {
    const articles = getAvailableArticles().sort();
    const isFirstArticle = articleId === articles[0];
    const isLastArticle = articleId === articles.at(-1);
    const md = Deno.readTextFileSync(`pages/${articleId}.md`);

    const hydratedPage = hydrateLayout({
        // E.g. "Flowcharts | EYLI Computing"
        title: md.match(/^#\s(.+)$/m)![1] + " | EYLI Computing",
        slot: generateHtml(md),
        prevUrl: isFirstArticle
            ? "/"
            : "/" + articles[articles.indexOf(articleId) - 1],
        nextUrl: "/" + articles[articles.indexOf(articleId) + 1],
    });

    let { html, css } = compileWindi(hydratedPage);

    // Hide next button on the last article
    if (isLastArticle) css += ".nextButton {visibility: hidden;}";

    // Save the stylesheet
    globalStyleCache = css;

    return new Response(html, RESPONSE_INIT.html);
}

let globalStyleCache = "";

/** Handle HTTP requests from the webapp. */
function handler(req: Request): Response {
    const url = new URL(req.url);

    switch (url.pathname) {
        case "/":
            return index();
        case "/global.css":
            // This assumes that a request to `/global.css` will
            // always come after a request to `/` or `/<article>`
            return new Response(globalStyleCache, RESPONSE_INIT.css);
        default:
            if (getAvailableArticles().includes(url.pathname.slice(1)))
                return article(url.pathname.slice(1));

            return new Response("404: Not found", RESPONSE_INIT.notFound);
    }
}

serve(handler, { port: 3000 });
console.log("Dev server on http://localhost:3000");
