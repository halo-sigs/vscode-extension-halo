import MarkdownIt = require("markdown-it");
import MarkdownItAnchor from "markdown-it-anchor";

const markdownIt = new MarkdownIt({
  html: true,
  xhtmlOut: true,
  breaks: true,
  linkify: true,
  typographer: true,
});

markdownIt.use(MarkdownItAnchor);

export default markdownIt;
