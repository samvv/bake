
const EOF = ''

function isWhiteSpace(ch: string): boolean {
  return /[\t\r\n ]/.test(ch);
}

function isIdentStart(ch: string): boolean {
  return /[a-z]/i.test(ch);
}

function isIdentPart(ch: string): boolean {
  return /[a-z0-9]/i.test(ch);
}

function isNewLine(ch: string): boolean {
  return ch === '\n';
}

class TextPos {

  constructor(
    public offset = 0,
    public line = 1,
    public column = 1,
  ) {

  }

  public clone(): TextPos {
    return new TextPos(this.offset, this.line, this.column);
  }

}

class LexError extends Error {

  constructor(
    message: string,
    public position: TextPos,
    public actual: string
  ) {
    super(message);
  }

}


export class Lexer {

  private charBuffer: string[] = [];

  public constructor(
    private readonly text: string,
    private offset = 0,
    private currPos = new TextPos(),
  ) {

  }

  private readChar(): string {
    return this.offset < this.text.length
        ? this.text[this.offset++]
        : EOF;
  }

  private getChar(): string {
    const ch = this.charBuffer.length > 0
      ? this.charBuffer.shift()!
      : EOF;
    return ch;
  }

  private peekChar(lookahead = 1): string {
    while (this.charBuffer.length < lookahead) {
      const ch = this.readChar();
      if (ch === EOF) {
        return EOF;
      }
      this.charBuffer.push(ch);
    }
    return this.charBuffer[lookahead-1];
  }

  private takeWhile(pred: (ch: string) => boolean): string {
    let out = ''
    for (;;) {
      const ch = this.peekChar()
      if (!pred(ch)) {
        break;
      }
      out += ch;
      this.getChar();
    }
    return out;
  }

  private getPosition(): TextPos {
    return this.currPos.clone();
  }

  private expectChar(expected: string): void {
    const ch = this.peekChar();
    if (ch !== expected) {
      throw new LexError(`Expected '${expected}' but got '${ch}'.`, this.getPosition(), ch);
    }
    this.getChar();
  }

  private skipComment() {
    this.expectChar('#')
    for (;;) {
      const c1 = this.getChar();
      if (isNewLine(c1) || c1 === EOF) {
        break;
      }
    }
  }

  private skipEmpty(): void {
    for (;;) {
      const c0 = this.peekChar();
      if (c0 === '#') {
        this.skipComment();
      }
      if (!isWhiteSpace(c0)) {
        break;
      }
      this.getChar();
    }
  }

  private lexIdentifier(): string {
    const c0 = this.peekChar();
    if (!isIdentPart(c0)) {
      throw new LexError(`Expected an identifier but got '${c0}'.`, this.getPosition(), c0);
    }
    return c0 + this.takeWhile(isIdentPart);
  }

  public lex() {
    this.skipEmpty();
    const c0 = this.peekChar();
    if (this.currPos.column !== 1) {
      throw new LexError(`Unexpected indentation. Target labels must be at the beginning of the line.`, this.getPosition(), c0);
    }
    const name = this.lexIdentifier()
    this.expectChar(':')
    const deps: string[] = [];
    for (;;) {
      this.takeWhile(ch => /[\t\r ]/.test(ch))
      const c1 = this.peekChar()
      if (c1 === '\n' || c1 === EOF) {
        break;
      }
      if (c1 === '#') {
        this.skipComment();
      }
      deps.push(this.lexIdentifier());
    }
    this.skipEmpty();
    const indent = this.currPos.column-1;
    if (indent > 0) {
      for (;;) {
        if (this.currPos.column === 1) {
          break;
        }
      }
    }
    return 
  }

}

