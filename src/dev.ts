import { serve } from "https://deno.land/std@0.128.0/http/server.ts";
import { Processor } from "https://esm.sh/windicss/lib";
import { HTMLParser } from "https://esm.sh/windicss/utils/parser";
import { micromark } from "https://esm.sh/micromark";

/**************        CODE FOR SITE GENERATION        **************/

/**
 * Given a HTML document containing Windi classes, output the corresponding stylesheet.
 * Taken from https://windicss.org/integrations/javascript.html.
 */
function generateStylesheet(html: string) {
    // Get windi processor
    const processor = new Processor();

    // Parse all classes and put into one line to simplify operations
    const htmlClasses = new HTMLParser(html)
        .parseClasses()
        .map((i) => i.result)
        .join(" ");

    // Generate preflight based on the HTML we input
    const preflightSheet = processor.preflight(html);

    // Process the HTML classes to an interpreted style sheet
    const interpretedSheet = processor.interpret(htmlClasses).styleSheet;

    // Build styles
    const APPEND = false;
    const MINIFY = false;
    const styles = interpretedSheet
        .extend(preflightSheet, APPEND)
        .build(MINIFY);

    return styles;
}

/** Return an array of all the Markdown articles in `/pages`. */
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
    return micromark(md);
}

/**
 * Given a HTML document and a `(slot id, content to hydrate)` hashmap,
 * return the HTML document with every `{{slot id}}` replaced by the
 * corresponding content to hydrate.
 */
function hydrate(html: string, targets: Record<string, string>): string {
    for (const t in targets) {
        html = html.replace(`{{${t}}}`, targets[t]);
    }

    return html;
}

/** Generate the `global.css` file used by `index.html` and `layout.html`. */
function generateGlobalCSS(): string {
    let stylesheet = "";

    for (const f of ["index", "layout"])
        stylesheet += generateStylesheet(
            Deno.readTextFileSync(`src/public/${f}.html`)
        );

    return stylesheet;
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

/** Response to the `/` route of the webapp. */
function index(): Response {
    const html = hydrate(Deno.readTextFileSync("src/public/layout.html"), {
        title: "EYLI Computing",
        slot: Deno.readTextFileSync("src/public/index.html"),
    });

    return new Response(html, RESPONSE_INIT.html);
}

/** Response to the `global.css` route of the webapp */
function css(): Response {
    return new Response(generateGlobalCSS(), RESPONSE_INIT.css);
}

/** Response to the `/<article>` route of the webapp. This assumes that the article exists. */
function article(articleId: string): Response {
    const md = Deno.readTextFileSync(`pages/${articleId}.md`);
    const html = hydrate(Deno.readTextFileSync("src/public/layout.html"), {
        title: md.match(/^#\s(.+)$/m)![1],
        slot: generateHtml(md),
    });

    return new Response(html, RESPONSE_INIT.html);
}

/** Handle HTTP requests from the webapp. */
function handler(req: Request): Response {
    const url = new URL(req.url);

    switch (url.pathname) {
        case "/":
            return index();
        case "/global.css":
            return css();
        default:
            console.log(url.pathname, getAvailableArticles());
            if (getAvailableArticles().includes(url.pathname.slice(1)))
                return article(url.pathname.slice(1));

            return new Response("404: Not found", RESPONSE_INIT.notFound);
    }
}

serve(handler, { port: 3000 });
console.log("Dev server on http://localhost:3000");
