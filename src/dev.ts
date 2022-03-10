/** This file contains the code for the dev server, to be ran whilst developing the webapp. */

import { serve } from "https://deno.land/std@0.128.0/http/server.ts";
import { micromark } from "https://esm.sh/micromark";
import { gfm, gfmHtml } from "https://esm.sh/micromark-extension-gfm";
import { buildWindi } from "./windi.ts";

/**************        CODE FOR SITE GENERATION        **************/

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
 * Given IDs for slots and their  hashmap, return  the HTML
 * with every `{slot id}` replaced by the corresponding content to hydrate.
 */
function hydrate(html: string, targets: Record<string, string>): string {
    for (const t in targets) {
        html = html.replaceAll(`{${t}}`, targets[t]);
    }

    return html;
}

/** Return the HTML of the navigation side bar. */
function generateNavBar(): string {
    let navHtml = "";

    // Each article gets its own section
    for (const file of getAvailableArticles().sort()) {
        // Get the markdown of the article
        const md = Deno.readTextFileSync(`pages/${file}.md`);
        // Get the title of the article
        const heading = md.match(/^#\s(.+)$/m)![1];
        // Get the subheaders of the article
        const subheadings = Array.from(md.matchAll(/^##\s(.+)$/gm))
            .map((t) => t[1])
            .slice(1);

        // HTML template for subheading navigation
        const subheadingTemplate = Deno.readTextFileSync(
            "src/html/subchapterNav.html"
        );

        // HTML template for article navigation
        const articleTemplate = Deno.readTextFileSync(
            "src/html/chapterNav.html"
        );
        let allSubheadings = "";

        // Hydrate all the subheading templates
        for (const text of subheadings) {
            allSubheadings += hydrate(subheadingTemplate, {
                subheading: text,
            });
        }

        // Hydrate the entire article nav
        navHtml += hydrate(articleTemplate, {
            chapterTitle: heading,
            subheadings: allSubheadings,
        });
    }

    return navHtml;
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
    svg: {
        headers: {
            "content-type": "image/svg+xml",
        },
    },
    notFound: {
        status: 404,
        headers: {
            "content-type": "text/plain; charset=utf-8",
        },
    },
};

const notFoundResponse = new Response("404: Not found", RESPONSE_INIT.notFound);

/** Response to the `/` route of the webapp. Writes to `globalStyleCache`. */
function index(): Response {
    const hydratedPage = hydrate(
        Deno.readTextFileSync("src/html/layout.html"),
        {
            title: "EYLI Computing",
            article: Deno.readTextFileSync("src/html/index.html"),
            // The next article is the first article
            nextUrl: getAvailableArticles().sort()[0],
            nav: generateNavBar(),
        }
    );

    let css = buildWindi(hydratedPage);

    // Hide prev button on the homepage
    css += ".prevButton {visibility: hidden;}";

    // Save the stylesheet
    globalStyleCache = css;

    return new Response(hydratedPage, RESPONSE_INIT.html);
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

    const hydratedPage = hydrate(
        Deno.readTextFileSync("src/html/layout.html"),
        {
            // E.g. "Flowcharts | EYLI Computing"
            title: md.match(/^#\s(.+)$/m)![1] + " | EYLI Computing",
            article: generateHtml(md),
            prevUrl: isFirstArticle
                ? "/"
                : "/" + articles[articles.indexOf(articleId) - 1],
            nextUrl: "/" + articles[articles.indexOf(articleId) + 1],
            nav: generateNavBar(),
        }
    );

    let css = buildWindi(hydratedPage);

    // Hide next button on the last article
    if (isLastArticle) css += ".nextButton {visibility: hidden;}";

    // Save the stylesheet
    globalStyleCache = css;

    return new Response(hydratedPage, RESPONSE_INIT.html);
}

let globalStyleCache = "";

/** Handle HTTP requests from the webapp. */
function handler(req: Request): Response {
    const url = new URL(req.url);

    if (url.pathname === "/") {
        return index();
    } else if (url.pathname === "/global.css") {
        // This assumes that a request to `/global.css` will
        // always come after a request to `/` or `/<article>`
        return new Response(globalStyleCache, RESPONSE_INIT.css);
    } else if (url.pathname.startsWith("/assets/")) {
        const fname = url.pathname.slice(8);
        const availableAssets = Array.from(Deno.readDirSync("src/assets")).map(
            (f) => f.name
        );

        if (availableAssets.includes(fname))
            // TODO: Account for PNGs & JPEGs
            return new Response(
                Deno.readTextFileSync(`src/assets/${fname}`),
                RESPONSE_INIT.svg
            );
        else return notFoundResponse;
    } else if (getAvailableArticles().includes(url.pathname.slice(1))) {
        return article(url.pathname.slice(1));
    } else {
        return notFoundResponse;
    }
}

serve(handler, { port: 3000 });
console.log("Dev server running on http://localhost:3000");
