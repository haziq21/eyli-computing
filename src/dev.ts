import { readFileSync, readdirSync, watch } from "fs";
import server from "server";
import { type, status } from "server/reply";
import { Processor } from "windicss/lib";
import { HTMLParser } from "windicss/utils/parser";

const micromark = await import("micromark");

/**
 * Given a HTML document containing Windi classes, output the corresponding stylesheet.
 * Taken from https://windicss.org/integrations/javascript.html.
 */
function generateStyles(html: string) {
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

function getAvailableArticles(): string[] {
    let articles: string[] = [];
    readdirSync("pages").forEach((f) => {
        if (f.endsWith(".md")) articles.push(f.slice(0, -3));
    });

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

let layoutHtml = readFileSync("src/public/layout.html", "utf8");
let indexHtml = readFileSync("src/public/index.html", "utf8");
let indexCss = generateStyles(indexHtml);
let layoutCss = generateStyles(layoutHtml);

let articles: Record<string, { title: string; html: string }> = {};

for (const file of readdirSync("pages")) {
    if (!file.endsWith(".md")) continue;

    const md = readFileSync(`pages/${file}`, "utf8");

    articles[file.slice(0, -3)] = {
        title: md.match(/^#\s(.+)$/m)![1],
        html: generateHtml(md),
    };
}

// Save HTML & re-compile stylesheet when index.html or layout.html is modified
watch("src/public", (eventType, filename) => {
    // Skip if it wasn't the HTML that got updated
    if (
        (filename !== "index.html" && filename !== "layout.html") ||
        eventType !== "change"
    )
        return;

    process.stdout.write(`Rebuilding ${filename}...  `);

    // Get the HTML and generate the stylesheets
    const html = readFileSync(`src/public/${filename}`, "utf8");
    const css = generateStyles(html);

    // Save the HTML & CSS
    if (filename === "index.html") {
        [indexHtml, indexCss] = [html, css];
    } else {
        [layoutHtml, layoutCss] = [html, css];
    }

    process.stdout.write("done\n");
});

// Re-compile HTML when Markdown is modified
watch("pages", (eventType, filename) => {
    // Skip if it wasn't the Markdown that got updated
    if (!filename.endsWith(".md") || eventType !== "change") return;

    const md = readFileSync(`pages/${filename}`, "utf8");

    articles[filename.slice(0, -3)] = {
        title: md.match(/^#\s(.+)$/m)![1],
        html: generateHtml(md),
    };
});

const { get } = server.router;
// Dev server to host the webapp
server(
    { port: 3000 },
    get("/global.css", (_) => type("text/css").send(indexCss + layoutCss)),
    get("/", (_) =>
        hydrate(layoutHtml, {
            title: "EYLI Computing",
            slot: indexHtml,
        })
    ),
    get("/:article", (ctx) => {
        const articleId = ctx.params.article;

        // Return a 404 if the article doesn't exist
        if (!(articleId in articles)) return status(404);

        return hydrate(layoutHtml, {
            title: articles[articleId].title,
            slot: articles[articleId].html,
        });
    })
).then((app) =>
    console.log(`Dev server running on http://127.0.0.1:${app.options.port}`)
);
