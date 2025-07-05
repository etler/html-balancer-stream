import { describe, it, expect } from "vitest";
import { balanceHtmlString, HtmlBalancerStream, HtmlBalancerStreamOptions } from "../src/index";
import { setTimeout } from "node:timers/promises";
import type { ReadableStreamReadResult } from "node:stream/web";

describe.concurrent("HtmlBalancerStream", { timeout: 1000 }, () => {
  // Unbuffered tags should be output as complete open or close tags in their own chunks regardless of the incoming chunk size
  // Text content should always emit immediately as it is recieved
  describe("unbuffered", () => {
    it("should buffer incomplete tags", async () => {
      const { push, finish } = getStreamController();
      push("<", "div", " class=", '"test"', ">", "content", "</", "div", ">");
      await expect(finish()).resolves.toEqual(['<div class="test">', "content", "</div>"]);
    });
    it("should balance unclosed tags on finish", async () => {
      const { push, take, finish } = getStreamController();
      push('<div class="test">content');
      await expect(take()).resolves.toEqual(['<div class="test">', "content"]);
      await expect(finish()).resolves.toEqual(["</div>"]);
    });
    it("should emit text chunks as soon as they are received", async () => {
      const { push, take, finish } = getStreamController();
      push('<div class="test">con');
      await expect(take()).resolves.toEqual(['<div class="test">', "con"]);
      push("tent</div>");
      await expect(take()).resolves.toEqual(["tent", "</div>"]);
      await expect(finish()).resolves.toEqual([]);
    });
  });

  // Buffered tags should not be output until all unclosed tags are closed
  // Text content should emit immediately if there are no unclosed tags
  describe("buffered", () => {
    it("should prevent streaming until all tags are closed", async () => {
      const { push, take, finish } = getStreamController({ buffer: true });
      push("<div>hello</div><div>world");
      await expect(take()).resolves.toEqual(["<div>hello</div>"]);
      await expect(finish()).resolves.toEqual(["<div>world</div>"]);
    });

    it("should buffer nested unclosed tags", async () => {
      const { push, take, finish } = getStreamController({ buffer: true });
      push("<div><p>content");
      await expect(take()).resolves.toEqual([]);
      push("</p></div>");
      await expect(take()).resolves.toEqual(["<div><p>content</p></div>"]);
      await expect(finish()).resolves.toEqual([]);
    });

    it("should emit text immediately when no unclosed tags", async () => {
      const { push, take, finish } = getStreamController({ buffer: true });
      push("hello world");
      await expect(take()).resolves.toEqual(["hello world"]);
      await expect(finish()).resolves.toEqual([]);
    });
  });

  describe("self-closing tags", () => {
    it("should handle self-closing tags in unbuffered mode", async () => {
      const { push, take, finish } = getStreamController();
      push("<img", " src=", '"test.jpg"', " alt=", '"image"', ">");
      await expect(take()).resolves.toEqual(['<img src="test.jpg" alt="image"/>']);
      await expect(finish()).resolves.toEqual([]);
    });

    it("should handle self-closing tags in buffered mode", async () => {
      const { push, take, finish } = getStreamController({ buffer: true });
      push('<br><img src="test.jpg"><hr>');
      await expect(take()).resolves.toEqual(["<br/>", '<img src="test.jpg"/>', "<hr/>"]);
      await expect(finish()).resolves.toEqual([]);
    });

    it("should handle mixed self-closing and regular tags", async () => {
      const { push, take, finish } = getStreamController();
      push("<div>content<br>more", "</div>");
      await expect(take()).resolves.toEqual(["<div>", "content", "<br/>", "more", "</div>"]);
      await expect(finish()).resolves.toEqual([]);
    });

    it("should handle fragmented self-closing tags", async () => {
      const { push, take, finish } = getStreamController();
      push("<", "b", "r", ">");
      await expect(take()).resolves.toEqual(["<br/>"]);
      await expect(finish()).resolves.toEqual([]);
    });

    it("should handle custom self-closing tags", async () => {
      const { push, take, finish } = getStreamController();
      push('<test-tag/><br><Wrapper><Custom src="test.jpg"/></Wrapper>');
      await expect(take()).resolves.toEqual([
        "<test-tag>",
        "</test-tag>",
        "<br/>",
        "<Wrapper>",
        '<Custom src="test.jpg">',
        "</Custom>",
        "</Wrapper>",
      ]);
      await expect(finish()).resolves.toEqual([]);
    });
    it("should handle custom self-closing tags in buffered mode", async () => {
      const { push, take, finish } = getStreamController({ buffer: true });
      push('<test-tag/><br><Wrapper><Custom src="test.jpg"/></Wrapper>');
      await expect(take()).resolves.toEqual([
        "<test-tag></test-tag>",
        "<br/>",
        '<Wrapper><Custom src="test.jpg"></Custom></Wrapper>',
      ]);
      await expect(finish()).resolves.toEqual([]);
    });
  });

  describe("unclosed tags at various nesting levels", () => {
    it("should handle single unclosed tag", async () => {
      const { push, take, finish } = getStreamController();
      push("<div>content");
      await expect(take()).resolves.toEqual(["<div>", "content"]);
      await expect(finish()).resolves.toEqual(["</div>"]);
    });

    it("should handle multiple nested unclosed tags", async () => {
      const { push, take, finish } = getStreamController();
      push("<div><p><span>content");
      await expect(take()).resolves.toEqual(["<div>", "<p>", "<span>", "content"]);
      await expect(finish()).resolves.toEqual(["</span>", "</p>", "</div>"]);
    });

    it("should handle partially closed nested tags", async () => {
      const { push, take, finish } = getStreamController();
      push("<div><p><span>content</span><em>more");
      await expect(take()).resolves.toEqual(["<div>", "<p>", "<span>", "content", "</span>", "<em>", "more"]);
      await expect(finish()).resolves.toEqual(["</em>", "</p>", "</div>"]);
    });

    it("should handle unclosed tags wrapped by closed parents", async () => {
      const { push, take, finish } = getStreamController();
      push("<div><p>unclosed content</div>");
      await expect(take()).resolves.toEqual(["<div>", "<p>", "unclosed content", "</p>", "</div>"]);
      await expect(finish()).resolves.toEqual([]);
    });

    it("should handle complex nesting with mixed closures", async () => {
      const { push, take, finish } = getStreamController();
      push("<div><p>text<span>more</span><em>unclosed</div>");
      await expect(take()).resolves.toEqual([
        "<div>",
        "<p>",
        "text",
        "<span>",
        "more",
        "</span>",
        "<em>",
        "unclosed",
        "</em>",
        "</p>",
        "</div>",
      ]);
      await expect(finish()).resolves.toEqual([]);
    });
  });

  describe("malformed tags and invalid HTML", () => {
    it("should handle incomplete tag at start", async () => {
      const { push, take, finish } = getStreamController();
      push("<div");
      await expect(take()).resolves.toEqual([]);
      push(">content</div>");
      await expect(take()).resolves.toEqual(["<div>", "content", "</div>"]);
      await expect(finish()).resolves.toEqual([]);
    });

    it("should handle incomplete tag at end", async () => {
      const { push, take, finish } = getStreamController();
      push("<div>content</d");
      await expect(take()).resolves.toEqual(["<div>", "content"]);
      await expect(finish()).resolves.toEqual(["</div>"]);
    });

    it("should handle malformed opening tag", async () => {
      const { push, take, finish } = getStreamController();
      push("< div>content</div>");
      await expect(take()).resolves.toEqual(["< div>content"]);
      await expect(finish()).resolves.toEqual([]);
    });

    it("should handle tag with missing closing bracket", async () => {
      const { push, take, finish } = getStreamController();
      push('<div class="test"');
      await expect(take()).resolves.toEqual([]);
      push(">content</div>");
      await expect(take()).resolves.toEqual(['<div class="test">', "content", "</div>"]);
      await expect(finish()).resolves.toEqual([]);
    });

    it("should handle invalid characters in tag names", async () => {
      const { push, take, finish } = getStreamController();
      push("<div-123>content</div-123>");
      await expect(take()).resolves.toEqual(["<div-123>", "content", "</div-123>"]);
      await expect(finish()).resolves.toEqual([]);
    });
  });

  describe("fragmented content", () => {
    it("should handle single character chunks", async () => {
      const { push, finish } = getStreamController();
      const chars = "<div>hello world</div>".split("");
      chars.forEach((char) => {
        push(char);
      });
      const result = await finish();
      expect(result.join("")).toBe("<div>hello world</div>");
    });

    it("should handle tag fragmented character by character", async () => {
      const { push, take, finish } = getStreamController();
      push("<", "d", "i", "v", " ", "c", "l", "a", "s", "s", "=", '"', "t", "e", "s", "t", '"', ">");
      await expect(take()).resolves.toEqual(['<div class="test">']);
      push("c", "o", "n", "t", "e", "n", "t");
      await expect(take()).resolves.toEqual(["c", "o", "n", "t", "e", "n", "t"]);
      await expect(finish()).resolves.toEqual(["</div>"]);
    });

    it("should handle mixed fragmentation patterns", async () => {
      const { push, finish } = getStreamController();
      push("<div", ">", "h", "ello ", "wor", "ld<", "/div>");
      const result = await finish();
      expect(result.join("")).toBe("<div>hello world</div>");
    });

    it("should handle attribute fragmentation", async () => {
      const { push, take, finish } = getStreamController();
      push("<div ", "class=", '"test', '-class"', " id=", '"my', '-id"', ">content</div>");
      await expect(take()).resolves.toEqual(['<div class="test-class" id="my-id">', "content", "</div>"]);
      await expect(finish()).resolves.toEqual([]);
    });
  });

  describe("streaming behavior edge cases", () => {
    it("should handle rapid consecutive tag opens and closes", async () => {
      const { push, take, finish } = getStreamController();
      push("<div><p></p><span></span></div>");
      await expect(take()).resolves.toEqual(["<div>", "<p>", "</p>", "<span>", "</span>", "</div>"]);
      await expect(finish()).resolves.toEqual([]);
    });

    it("should handle empty tags", async () => {
      const { push, take, finish } = getStreamController();
      push("<div></div><p></p>");
      await expect(take()).resolves.toEqual(["<div>", "</div>", "<p>", "</p>"]);
      await expect(finish()).resolves.toEqual([]);
    });

    it("should handle whitespace-only content", async () => {
      const { push, take, finish } = getStreamController();
      push("<div>   \n\t  </div>");
      await expect(take()).resolves.toEqual(["<div>", "   \n\t  ", "</div>"]);
      await expect(finish()).resolves.toEqual([]);
    });

    it("should handle buffered mode with immediate text after closed tags", async () => {
      const { push, take, finish } = getStreamController({ buffer: true });
      push("<div>content</div>immediate text<p>more");
      await expect(take()).resolves.toEqual(["<div>content</div>", "immediate text"]);
      await expect(finish()).resolves.toEqual(["<p>more</p>"]);
    });

    it("should handle complex buffered streaming pattern", async () => {
      const { push, take, finish } = getStreamController({ buffer: true });
      push("<div>first</div>");
      await expect(take()).resolves.toEqual(["<div>first</div>"]);
      push("text<span>second");
      await expect(take()).resolves.toEqual(["text"]);
      push("</span>more text<p>third");
      await expect(take()).resolves.toEqual(["<span>second</span>", "more text"]);
      await expect(finish()).resolves.toEqual(["<p>third</p>"]);
    });
  });

  describe("attributes and special characters", () => {
    it("should handle attributes with special characters", async () => {
      const { push, take, finish } = getStreamController();
      push('<div data-test="value with spaces" class="test&amp;more">content</div>');
      await expect(take()).resolves.toEqual([
        '<div data-test="value with spaces" class="test&more">',
        "content",
        "</div>",
      ]);
      await expect(finish()).resolves.toEqual([]);
    });

    it("should handle unicode content", async () => {
      const { push, take, finish } = getStreamController();
      push("<div>Hello 世界 🌍 émojis</div>");
      await expect(take()).resolves.toEqual(["<div>", "Hello 世界 🌍 émojis", "</div>"]);
      await expect(finish()).resolves.toEqual([]);
    });

    it("should preserve mixed case tag names", async () => {
      const { push, take, finish } = getStreamController();
      push("<Div>content</Div><DIV>more");
      await expect(take()).resolves.toEqual(["<Div>", "content", "</Div>", "<DIV>", "more"]);
      await expect(finish()).resolves.toEqual(["</DIV>"]);
    });

    it("should handle boolean attributes", async () => {
      const { push, take, finish } = getStreamController();
      push('<input disabled checked type="checkbox">');
      await expect(take()).resolves.toEqual(['<input disabled="" checked="" type="checkbox"/>']);
      await expect(finish()).resolves.toEqual([]);
    });

    it("should handle attributes without quotes", async () => {
      const { push, take, finish } = getStreamController();
      push("<div class=test id=myid>content</div>");
      await expect(take()).resolves.toEqual(['<div class="test" id="myid">', "content", "</div>"]);
      await expect(finish()).resolves.toEqual([]);
    });
  });

  describe("extreme edge cases", () => {
    it("should handle deeply nested structure", async () => {
      const { push, take, finish } = getStreamController();
      push("<a><b><c><d><e><f><g><h><i><j>deep</j></i></h></g></f></e></d></c></b></a>");
      await expect(take()).resolves.toEqual([
        "<a>",
        "<b>",
        "<c>",
        "<d>",
        "<e>",
        "<f>",
        "<g>",
        "<h>",
        "<i>",
        "<j>",
        "deep",
        "</j>",
        "</i>",
        "</h>",
        "</g>",
        "</f>",
        "</e>",
        "</d>",
        "</c>",
        "</b>",
        "</a>",
      ]);
      await expect(finish()).resolves.toEqual([]);
    });

    it("should handle deeply nested unclosed structure", async () => {
      const { push, take, finish } = getStreamController();
      push("<a><b><c><d><e>deep content");
      await expect(take()).resolves.toEqual(["<a>", "<b>", "<c>", "<d>", "<e>", "deep content"]);
      await expect(finish()).resolves.toEqual(["</e>", "</d>", "</c>", "</b>", "</a>"]);
    });

    it("should handle mixed valid and invalid nesting", async () => {
      const { push, take, finish } = getStreamController();
      push("<div><p><span>valid</span><em>unclosed</div>");
      await expect(take()).resolves.toEqual([
        "<div>",
        "<p>",
        "<span>",
        "valid",
        "</span>",
        "<em>",
        "unclosed",
        "</em>",
        "</p>",
        "</div>",
      ]);
      await expect(finish()).resolves.toEqual([]);
    });

    it("should handle interleaved text and tags", async () => {
      const { push, take, finish } = getStreamController();
      push("start<div>middle</div>between<p>end</p>final");
      await expect(take()).resolves.toEqual([
        "start",
        "<div>",
        "middle",
        "</div>",
        "between",
        "<p>",
        "end",
        "</p>",
        "final",
      ]);
      await expect(finish()).resolves.toEqual([]);
    });

    it("should handle tags with no content between them", async () => {
      const { push, take, finish } = getStreamController();
      push("<div><p><span></span></p></div>");
      await expect(take()).resolves.toEqual(["<div>", "<p>", "<span>", "</span>", "</p>", "</div>"]);
      await expect(finish()).resolves.toEqual([]);
    });

    it("should handle very long attribute values", async () => {
      const { push, take, finish } = getStreamController();
      const longValue = "a".repeat(1000);
      push(`<div data-long="${longValue}">content</div>`);
      await expect(take()).resolves.toEqual([`<div data-long="${longValue}">`, "content", "</div>"]);
      await expect(finish()).resolves.toEqual([]);
    });

    it("should handle extremely fragmented input", async () => {
      const { push, finish } = getStreamController();
      const html = '<div class="test" id="example">Hello <span>world</span>!</div>';
      html.split("").forEach((char) => {
        push(char);
      });
      const result = await finish();
      expect(result.join("")).toBe('<div class="test" id="example">Hello <span>world</span>!</div>');
    });

    it("should handle rapid buffered/unbuffered transitions", async () => {
      const { push, take, finish } = getStreamController({ buffer: true });
      push("text1<div>buffered1</div>text2");
      await expect(take()).resolves.toEqual(["text1", "<div>buffered1</div>", "text2"]);
      push("<p>buffered2");
      await expect(take()).resolves.toEqual([]);
      push("</p>text3<span>buffered3</span>");
      await expect(take()).resolves.toEqual(["<p>buffered2</p>", "text3", "<span>buffered3</span>"]);
      await expect(finish()).resolves.toEqual([]);
    });

    it("should handle text with HTML-like content that isn't tags", async () => {
      const { push, take, finish } = getStreamController();
      push("<div>This < that > other & <script> alert('not a real script'); </script></div>");
      await expect(take()).resolves.toEqual([
        "<div>",
        "This ",
        "< that > other & ",
        "<script>",
        " alert('not a real script'); ",
        "</script>",
        "</div>",
      ]);
      await expect(finish()).resolves.toEqual([]);
    });

    it("should handle comments and CDATA-like content", async () => {
      const { push, finish } = getStreamController();
      push("<div><!-- comment -->content<![CDATA[data]]></div>");
      const result = await finish();
      expect(result.join("").includes("content")).toBe(true);
    });

    it("should handle mismatched tag names", async () => {
      const { push, take, finish } = getStreamController();
      push("<div>content</span>");
      await expect(take()).resolves.toEqual(["<div>", "content"]);
      await expect(finish()).resolves.toEqual(["</div>"]);
    });

    it("should handle multiple self-closing tags in sequence", async () => {
      const { push, take, finish } = getStreamController();
      push("<br><hr><img src='test'><input type='text'><meta charset='utf-8'>");
      await expect(take()).resolves.toEqual([
        "<br/>",
        "<hr/>",
        '<img src="test"/>',
        '<input type="text"/>',
        '<meta charset="utf-8"/>',
      ]);
      await expect(finish()).resolves.toEqual([]);
    });

    it("should handle streaming with alternating chunk sizes", async () => {
      const { push, take, finish } = getStreamController();
      push("<");
      await expect(take()).resolves.toEqual([]);
      push("div>");
      await expect(take()).resolves.toEqual(["<div>"]);
      push("a");
      await expect(take()).resolves.toEqual(["a"]);
      push("bc");
      await expect(take()).resolves.toEqual(["bc"]);
      push("d");
      await expect(take()).resolves.toEqual(["d"]);
      push("</div>");
      await expect(take()).resolves.toEqual(["</div>"]);
      await expect(finish()).resolves.toEqual([]);
    });

    it("should handle buffered mode with complex nesting patterns", async () => {
      const { push, take, finish } = getStreamController({ buffer: true });
      push("start");
      await expect(take()).resolves.toEqual(["start"]);
      push("<div><p>nested");
      await expect(take()).resolves.toEqual([]);
      push("<span>deep</span>");
      await expect(take()).resolves.toEqual([]);
      push("</p></div>");
      await expect(take()).resolves.toEqual(["<div><p>nested<span>deep</span></p></div>"]);
      push("end");
      await expect(take()).resolves.toEqual(["end"]);
      await expect(finish()).resolves.toEqual([]);
    });

    it("should handle empty input", async () => {
      const { push, take, finish } = getStreamController();
      push("");
      await expect(take()).resolves.toEqual([]);
      await expect(finish()).resolves.toEqual([]);
    });

    it("should handle only whitespace input", async () => {
      const { push, take, finish } = getStreamController();
      push("   \n\t\r  ");
      await expect(take()).resolves.toEqual(["   \n\t\r  "]);
      await expect(finish()).resolves.toEqual([]);
    });

    it("should handle single character inputs", async () => {
      const { push, take, finish } = getStreamController();
      push("a");
      await expect(take()).resolves.toEqual(["a"]);
      push("b");
      await expect(take()).resolves.toEqual(["b"]);
      push("c");
      await expect(take()).resolves.toEqual(["c"]);
      await expect(finish()).resolves.toEqual([]);
    });
  });
});

describe("balanceHtmlString", () => {
  it("should balance unclosed tags at the end content", () => {
    const result = balanceHtmlString("<div>content");
    expect(result).toBe("<div>content</div>");
  });

  it("should balance unclosed tags when a parent closes", () => {
    const result = balanceHtmlString("<div><p>content</div>");
    expect(result).toBe("<div><p>content</p></div>");
  });
});

// Utility function to return an object of Controller manipulation functions
// for testing a ReadableStream instance piped through HtmlBalancerStream
function getStreamController(options?: HtmlBalancerStreamOptions): {
  // Multi chunk enqueue
  push: (...chunk: string[]) => void;
  // Read pending html strings from the stream
  take: () => Promise<string[]>;
  // Close and flush the stream, must only be called once
  finish: () => Promise<string[]>;
} {
  let maybeController: ReadableStreamDefaultController<string> | undefined;
  const readable = new ReadableStream<string>({
    start(internalController) {
      maybeController = internalController;
    },
  });
  if (maybeController === undefined) {
    throw new Error("Stream controller could not be extracted");
  }
  const controller = maybeController;
  const balancer = new HtmlBalancerStream(options);
  const stream = readable.pipeThrough(balancer);
  const enqueue = controller.enqueue.bind(controller);
  const push = (...chunks: string[]) => {
    chunks.forEach(enqueue);
  };
  const reader = stream.getReader();
  let pendingRead: Promise<ReadableStreamReadResult<string>> | undefined;
  const take = async () => {
    const output: string[] = [];
    while (true) {
      pendingRead ??= reader.read();
      const result = await Promise.race([pendingRead, setTimeout(0)]);
      if (!result) {
        break;
      }
      pendingRead = undefined;
      const { value, done } = result;
      if (value !== undefined) {
        output.push(value);
      }
      if (done) {
        break;
      }
    }
    return output;
  };
  const finish = async () => {
    controller.close();
    return take();
  };
  return {
    push,
    take,
    finish,
  };
}
