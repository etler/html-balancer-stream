# html-balancer-stream

A TypeScript library for balancing, normalizing, and buffering streaming HTML tags with Web Streams API support.

## Installation

```bash
npm install html-balancer-stream
```

### Requirements

Node.js 18+ or modern browsers with Web Streams support

## Quick Start

```typescript
import { HtmlBalancerStream, balanceHtmlString } from 'html-balancer-stream';

// Streaming mode
const stream = response.body
  ?.pipeThrough(new TextDecoderStream())
  .pipeThrough(new HtmlBalancerStream({ buffer: true }));

// String mode
const html = balanceHtmlString('<div>content');
// Outputs "<div>content</div>"
```

## API

Unclosed tags will be automatically balanced when the stream ends. Unclosed child tags will be balanced if a parent tag closes.

### `HtmlBalancerStream`

Transform stream class for buffering and balancing an HTML input stream.

```typescript
class HtmlBalancerStream extends TransformStream<string, string> {
  constructor(options?: HtmlBalancerStreamOptions);
}
```

### `HtmlBalancerStreamOptions`

```typescript
interface HtmlBalancerStreamOptions {
  buffer?: boolean
}
```

#### `buffer`

When `true`, delay outputting html tags until all parents are closed. This is useful for processing HTML fragments.
Incomplete HTML tags will always be buffered until they are fully closed or confirmed to not be tags.
Text content will immediately stream in chunks as they are received.

### `balanceHtmlString`

Non streaming utility for normalizing and balancing an HTML string. Useful for normalizing partial HTML strings from an in progress HTML stream for rendering streaming content.

```typescript
function balanceHtmlString(
  html: string
): string;
```

## License

MIT
