import { Parser } from "htmlparser2";

type HtmlNode =
  | {
      type: "open";
      name: string;
      attributes: Record<string, string>;
    }
  | {
      type: "close";
      name: string;
    }
  | {
      type: "text";
      text: string;
    };

export interface HtmlBalancerStreamOptions {
  buffer?: boolean;
}

export class HtmlBalancerStream extends TransformStream<string, string> {
  // Class instance options
  readonly options: Required<HtmlBalancerStreamOptions>;
  // Stream controller to enqueue data
  private controller: TransformStreamDefaultController<string>;
  // SAX-like HTML parser for content events
  private parser: Parser;
  // Initialize stream and register parsing hooks
  constructor({ buffer: shouldBuffer }: HtmlBalancerStreamOptions = {}) {
    let maybeController: TransformStreamDefaultController<string> | undefined;
    super({
      start: (controller) => {
        maybeController = controller;
      },
      transform: (chunk) => {
        this.parser.write(chunk);
      },
      flush: () => {
        this.parser.end();
      },
    });
    if (maybeController === undefined) {
      throw new Error("Stream controller could not be registered");
    }
    this.controller = maybeController;
    this.options = { buffer: shouldBuffer ?? false };
    this.parser = makeParser(this.controller.enqueue.bind(this.controller), this.options);
  }
}

export function balanceHtmlString(htmlString: string): string {
  let result = "";
  const parser = makeParser(
    (chunk) => {
      result += chunk;
    },
    { buffer: false },
  );
  // Remove any potentally malformed html tags at the end of input
  parser.end(htmlString.replace(/<[^>]*$/, ""));
  return result;
}

function makeParser(enqueue: (chunk: string) => void, options: Required<HtmlBalancerStreamOptions>): Parser {
  let unclosed = 0;
  const buffer: HtmlNode[] = [];
  const flush = () => {
    if (buffer.length > 0) {
      enqueue(htmlNodesToString(buffer.splice(0)));
    }
  };
  return new Parser(
    {
      onopentag: (name, attributes) => {
        unclosed++;
        buffer.push({ type: "open", name, attributes });
        // Only output tags if tag buffering is disabled
        if (!options.buffer) {
          flush();
        }
      },
      ontext: (text) => {
        // Sanitize raw `<` and `>`
        const sanitizedText = text.replaceAll("<", "&lt;").replaceAll(">", "&gt;");
        // Add plain text to the buffer
        buffer.push({ type: "text", text: sanitizedText });
        // Flush the buffer if tag buffering is disabled or if all tags are closed
        if (!options.buffer || unclosed === 0) {
          flush();
        }
      },
      // htmlparser2 automatically closes tags in order when needed
      onclosetag: (name) => {
        unclosed--;
        if (!isSelfClosingTag(name)) {
          buffer.push({ type: "close", name });
        }
        // Flush the buffer if tag buffering is disabled or if all tags are closed
        if (!options.buffer || unclosed === 0) {
          flush();
        }
      },
    },
    {
      // Parser options to avoid making unnecessary modifications to the input stream
      lowerCaseAttributeNames: false,
      lowerCaseTags: false,
      recognizeSelfClosing: true,
    },
  );
}

function htmlNodesToString(nodes: HtmlNode[]): string {
  return nodes
    .map((node): string => {
      switch (node.type) {
        case "open": {
          const attributeStrings = Object.entries(node.attributes).map(
            ([key, value]) => `${key}=${JSON.stringify(value)}`,
          );
          const closeTag = isSelfClosingTag(node.name) ? "/" : "";
          return `<${[node.name, ...attributeStrings].join(" ")}${closeTag}>`;
        }
        case "close": {
          return `</${node.name}>`;
        }
        default: {
          return node.text;
        }
      }
    })
    .join("");
}

const selfClosingTags = [
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
];

function isSelfClosingTag(tag: string): boolean {
  return selfClosingTags.includes(tag);
}
