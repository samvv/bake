import { Interface } from "readline";

const EOF = '';

export enum ShellTokenType {
  NewLine,
  Blank,
  EndOfFile,
  Identifier,
  AmpAmp,
  VBarVBar,
  Dollar,
  OpenParen,
  CloseParen,
}

function describeToken(type: ShellTokenType) {
  switch (type) {
    case ShellTokenType.CloseParen: return "')'";
    case ShellTokenType.OpenParen: return "'('";
    case ShellTokenType.Blank: return "some whitespace";
    case ShellTokenType.Dollar: return "'$'";
    case ShellTokenType.AmpAmp: return "'&&'";
    case ShellTokenType.VBarVBar: return "'||'";
    case ShellTokenType.Identifier: return "some text";
    case ShellTokenType.EndOfFile: return "end-of-file";
  }
}

export class ShellToken {

  constructor(public type: ShellTokenType, public value?: any) {

  }

}

export enum ShellNodeType {
  TextExpr,
  RefExpr,
  StringExpr,
  TemplateStringExpr,
  SpawnCommand,
  AndCommand,
  OrCommand,
  NotCommand,
}

export interface ShellNodeBase {
  type: ShellNodeType;
}

export interface TextShellExpr extends ShellNodeBase {
  type: ShellNodeType.TextExpr;
  text: string;
}

export interface RefShellExpr extends ShellNodeBase {
  type: ShellNodeType.RefExpr;
  name: string;
}

export interface StringShellExpr extends ShellNodeBase {
  type: ShellNodeType.StringExpr;
  text: string;
}

export type TemplateStringShellExprElement
  = RefShellExpr
  | TextShellExpr

export interface TemplateStringShellExpr extends ShellNodeBase {
  type: ShellNodeType.TemplateStringExpr;
  elements: TemplateStringShellExprElement[];
}

export type ShellExpr
  = TextShellExpr
  | RefShellExpr
  | StringShellExpr
  | TemplateStringShellExpr

export type ShellNode
  = TextShellExpr
  | RefShellExpr
  | AndShellCommand
  | OrShellCommand
  | NotShellCommand
  | SpawnShellCommand

export interface SpawnShellCommand extends ShellNodeBase {
  type: ShellNodeType.SpawnCommand;
  args: ShellArg[];
}

export interface NotShellCommand extends ShellNodeBase {
  type: ShellNodeType.NotCommand;
  command: ShellCommand;
}

export interface AndShellCommand extends ShellNodeBase {
  type: ShellNodeType.AndCommand;
  left: ShellCommand;
  right: ShellCommand;
}

export interface OrShellCommand extends ShellNodeBase {
  type: ShellNodeType.OrCommand;
  left: ShellCommand;
  right: ShellCommand;
}

export type BinaryShellCommand
  = AndShellCommand
  | OrShellCommand

export type ShellArg = ShellExpr[];

export type ShellCommand
  = OrShellCommand
  | AndShellCommand
  | SpawnShellCommand
  | NotShellCommand

export class LexError extends Error {

}

export class ShellLexer {

  private charBuffer: string[] = [];

  constructor(private text: string, private textOffset = 0) {

  }

  private readChar() {
    return this.textOffset < this.text.length
        ? this.text[this.textOffset++]
        : EOF;
  }

  private getChar(): string {
    return this.charBuffer.length > 0 
      ? this.charBuffer.shift()!
      : this.readChar();
  }

  private peekChar(offset = 1): string {
    while (this.charBuffer.length < offset) {
      const ch = this.readChar();
      if (ch === EOF) {
        return EOF;
      }
      this.charBuffer.push(ch);
    }
    return this.charBuffer[offset - 1];
  }

  private expectChar(expected: string): void {
    const actual = this.peekChar();
    if (actual !== expected) {
      throw new LexError(`Expected character '${expected}' but got '${actual}'`);
    }
    this.getChar();
  }

  public lex() {
    let escaping = false;
    let afterBlank = false;
    for (;;) {

      const ch = this.peekChar();

      // Return early if there are no more characters to be processed. If
      // afterBlank is true, we just had some dangling whitespace. If escaping
      // is still true, we probably want to signal an error.
      if (ch === EOF) {
        if (escaping) {
          throw new LexError(`Reached end-of-file while trying to escape a character with '\\'`)
        }
        return new ShellToken(ShellTokenType.EndOfFile);
      }

      // A '\' influences the next character so we simply skip over it and
      // remember that we encountered it.
      if (ch === '\\') {
        this.getChar();
        escaping = true;
        continue;
      }

      // Whitespace cannot be ignored because it seperates command-line
      // arguments. Above that, a newline is treated differently depending on
      // whether it was escaped or not.
      if (/[\t\r ]/.test(ch) || (ch === '\n' && escaping)) {
        this.getChar();
        afterBlank = true;
        continue;
      }

      // We processed an escaped newline in the previous block, so the only
      // case that remains is to process a real newline that seperates two
      // shell commands.
      if (ch === '\n') {
        this.getChar();
        return new ShellToken(ShellTokenType.NewLine);
      }

      // If we got this far we can be sure there is no more whitespace.
      // However, the previous characters might have been whitespace or an
      // escaped newline. We create a special token to indicate the possilbe
      // start of a new argument.
      if (afterBlank) {
        afterBlank = false;
        return new ShellToken(ShellTokenType.Blank);
      }

      // The following are all just special characters that are returned as-is.
      // It is up to the parser to make sense of them.

      if (!escaping && ch === '$') {
        this.getChar();
        const c1 = this.peekChar();
        if (!/[a-z_]/i.test(c1)) {
          throw new LexError(`Expected '_' or a letter for a variable name but got '${c1}'`)
        }
        let name = c1;
        this.getChar();
        for (;;) {
          const c2 = this.peekChar();
          if (!/[a-z0-9]/i.test(c2)) {
            break;
          }
          name += c2;
          this.getChar();
        }
        return new ShellToken(ShellTokenType.Dollar, name);
      }

      if (ch === '&') {
        this.getChar();
        this.expectChar('&');
        return new ShellToken(ShellTokenType.AmpAmp);
      }

      if (ch === '|') {
        this.getChar();
        this.expectChar('|');
        return new ShellToken(ShellTokenType.VBarVBar);
      }

      // The only thing remaining is pure text. This includes '-' and '_'
      // because sh treats them as valid identifiers even when given as the
      // command name.
      let text = '';
      if (escaping) {
        text += unescape(ch);
        escaping = false;
      }
      this.getChar();
      text += ch;
      for (;;) {
        const c1 = this.peekChar();
        if (c1 === EOF || /[$\t\r\n&| '"]/.test(c1)) {
          break;
        }
        text += c1;
        this.getChar();
      }
      return new ShellToken(ShellTokenType.Identifier, text);

      // If we ended up here then we have no more valid characters left, so the
      // only sensible thing to do is to report an error.
      // throw new LexError(`Unexpected character '${ch}'`);

    }

  }

}

export class ParseError extends Error {

}

export class ShellParser {

  private tokenBuffer: ShellToken[] = [];

  constructor(private lexer: ShellLexer) {

  }

  private getToken() {
    return this.tokenBuffer.length > 0
      ? this.tokenBuffer.shift()!
      : this.lexer.lex();
  }

  private peekToken(offset = 1) {
    while (this.tokenBuffer.length < offset) {
      this.tokenBuffer.push(this.lexer.lex());
    }
    return this.tokenBuffer[offset-1];
  }

  private expectToken(expectedType: ShellTokenType) {
    const token = this.getToken();
    if (token.type !== expectedType) {
      throw new ParseError(`Expected ${describeToken(expectedType)} but got ${describeToken(token.type)}`);
    }
  }

  private parseExpr(): ShellExpr {
    const t0 = this.getToken();
    if (t0.type === ShellTokenType.Dollar) {
      return { type: ShellNodeType.RefExpr, name: t0.value }
    } else if (t0.type === ShellTokenType.Identifier) {
      return { type: ShellNodeType.TextExpr, text: t0.value }
    } else {
      throw new ParseError(`Did not expect ${describeToken(t0.type)}`);
    }
  }

  private getPrecedence(type: ShellTokenType): number {
    switch (type) {
      case ShellTokenType.VBarVBar: return 1;
      case ShellTokenType.AmpAmp: return 1;
      default:
        throw new Error(`Could not get precedence of token type ${ShellTokenType[type]}: not a binary operator`);
    }
  }

  private isBinaryOperator(tokenType: ShellTokenType) {
    return tokenType === ShellTokenType.VBarVBar
        || tokenType === ShellTokenType.AmpAmp
  }

  private isRightAssoc(_tokenType: ShellTokenType): boolean {
    return false;
  }

  private operatorToExprType(tokenType: ShellTokenType): ShellNodeType {
    switch (tokenType) {
      case ShellTokenType.AmpAmp: return ShellNodeType.AndCommand;
      case ShellTokenType.VBarVBar: return ShellNodeType.OrCommand;
      default:
        throw new Error(`Could not convert ${ShellTokenType[tokenType]} to a shell expression type: not a binary operator`);
    }
  }

  private parseCommandOperators(lhs: ShellCommand, minPrecedence = 0): ShellCommand {

    // This variable will always contain an operator. If it doesn't the loop
    // below will stop.
    let lookahead = this.peekToken();

    for (;;) {

      if (!this.isBinaryOperator(lookahead.type)) {
        break;
      }

      // In the nested loop below, everything is matched against this
      // precedence level because if it does not match, the outer loop should
      // take over.
      const fixedPrecedence = this.getPrecedence(lookahead.type);

      if (fixedPrecedence < minPrecedence) {
        break;
      }

      // Store the operator so that we know what expression to build later on.
      const operator = lookahead;

      this.getToken()

      // Do not forget to parse any whitespace that might be between && and the
      // following command. The lexer cannot know upfront when this special
      // token is not needed, so the only solution is to explicitly process it
      // here.
      if (this.peekToken().type === ShellTokenType.Blank) {
        this.getToken();
      }

      let rhs = this.parseCommandPrimitive();

      lookahead = this.peekToken();

      for (;;) {

        if (!this.isBinaryOperator(lookahead.type)) {
          break;
        }

        const lookaheadPrecedence = this.getPrecedence(lookahead.type);
        if (lookaheadPrecedence < fixedPrecedence
          || (lookaheadPrecedence === fixedPrecedence
            && !this.isRightAssoc(lookahead.type))) {
          break;
        }

        // Build a left-assoctiative expression.
        rhs = this.parseCommandOperators(rhs, lookaheadPrecedence);

        // Needed in order to keep the invariant that lookahead always points to
        // the next operator in the token stream.
        lookahead = this.peekToken();

      }

      // Finally we can build the actual expression where left-associative
      // expressions have already been dealt with in the nested loop above.
      lhs = {
        type: this.operatorToExprType(operator.type),
        left: lhs,
        right: rhs,
      } as BinaryShellCommand

    }

    return lhs;

  }

  public parseCommandInternal(): ShellCommand {
    return this.parseCommandOperators(this.parseCommandPrimitive());
  }

  public parseArg(): ShellArg {
    let elements = [];
    for (;;) {
      const t0 = this.peekToken();
      if ( this.isBinaryOperator(t0.type)
        || t0.type === ShellTokenType.Blank
        || t0.type === ShellTokenType.CloseParen
        || t0.type === ShellTokenType.NewLine
        || t0.type === ShellTokenType.EndOfFile) {
        break;
      }
      elements.push(this.parseExpr());
    }
    return elements;
  }

  private parseCommandPrimitive(): ShellCommand {
    const args = [];
    for (;;) {
      const t0 = this.peekToken();
      if ( this.isBinaryOperator(t0.type)
        || t0.type === ShellTokenType.EndOfFile
        || t0.type === ShellTokenType.NewLine
        || t0.type === ShellTokenType.CloseParen) {
        break;
      }
      args.push(this.parseArg());
      const t1 = this.peekToken();
      if (this.isBinaryOperator(t0.type)
        || t1.type === ShellTokenType.EndOfFile
        || t1.type === ShellTokenType.NewLine
        || t1.type === ShellTokenType.CloseParen) {
        break;
      }
      this.expectToken(ShellTokenType.Blank)
    }
    return { type: ShellNodeType.SpawnCommand, args }
  }

  public parseCommand(): ShellCommand {
    const command = this.parseCommandInternal();
    this.expectToken(ShellTokenType.EndOfFile);
    return command;
  }

}

export function parseShellCommand(input: string): ShellCommand {
  const lexer = new ShellLexer(input);
  const parser = new ShellParser(lexer);
  return parser.parseCommand()
}

export type ProcessEnvironment = { [key: string]: string | undefined }

export interface SpawnOptions {
  cwd?: string;
  env?: ProcessEnvironment;
}

export type ShellCommandFn = (
  this: ShellEvaluator,
  argv: string[],
  next: (exitCode: number) => void,
  exit: (exitCode: number) => void
) => void;

export interface ShellBuiltins {
  [key: string]: ShellCommandFn;
}

export type SpawnFn = (argv: string[], opts: SpawnOptions) => Promise<number | null>;

export interface EvalShellCommandOptions {
  spawn(argv: string[], opts?: SpawnOptions): Promise<number | null>;
  cwd?: string;
  env?: ProcessEnvironment;
  extraBuiltins?: ShellBuiltins,
  noDefaultBuiltins?: boolean;
}

function shouldHoist(expr: ShellExpr): boolean {
  return expr.type !== ShellNodeType.StringExpr
      && expr.type !== ShellNodeType.TemplateStringExpr;
}

const DEFAULT_BUILTINS: ShellBuiltins = {
  exit([ exitCodeStr ], _next, exit) {
    if (exitCodeStr === undefined) {
      exit(0);
    }
    const exitCode = Number(exitCodeStr);
    exit(isNaN(exitCode) ? 0 : exitCode);
  }
}

export class ShellEvaluator {

  constructor(
    public cwd: string,
    public env: ProcessEnvironment,
    private builtins: ShellBuiltins,
    private spawnInternal: SpawnFn,
  ) {

  }

  public async spawn(argv: string[]): Promise<number> {
    const exitCode = await this.spawnInternal(argv, {
      cwd: this.cwd,
      env: this.env
    });
    return exitCode === null ? 1 : exitCode;
  }

  public async evalShellExpr(expr: ShellExpr): Promise<string> {

    switch (expr.type) {

      case ShellNodeType.TextExpr:
        return expr.text;

      case ShellNodeType.RefExpr:
        return this.env[expr.name] ?? '';

      case ShellNodeType.TemplateStringExpr:

        let out = '';

        // We could use Promise.all but it seems that Bash just evaluates the
        // nested expressions in sequence. For example, if you type "$(sleep 1)
        // $(sleep 2)", the shell will sleep for 3 seconds.
        for (const element of expr.elements) {
          out += await this.evalShellExpr(element);
        }

        return out;

      default:
          throw new Error(`Could not evaluate shell expression: unknown node type`);

    }

  }



  public eval(command: string | ShellCommand): Promise<number> {

    const visit = async (
      command: ShellCommand,
      next: (exitCode: number) => void,
      exit: (exitCode: number) => void
    ) => {

      switch (command.type) {

        case ShellNodeType.SpawnCommand:
          {
            // The full list of process arguments for spawn() will be stored in this
            // variable.
            const argv: string[] = [];

            // Populate argv by evaluating each parsed expression in the command.
            // If the expression is hoistable (e.g. $FOO expands to 'foo bar bax')
            // then we split the result and add each part as a seperate argument.
            // If the expression is not hoistable (e.g. the literal '"foo bar bax")
            // then we just add it as a single big argument.
            for (const arg of command.args) {
              for (const expr of arg) {
                const result = await this.evalShellExpr(expr);
                if (shouldHoist(expr)) {
                  for (const chunk of result.split(' ')) {
                    argv.push(chunk);
                  }
                } else {
                  argv.push(result);
                }
              }
            }

            // First we check if there is a builtin with the given name. We always
            // give priority to the builtin, so return early if found.
            const builtin = this.builtins[argv[0]];
            if (builtin !== undefined) {
              builtin.call(this, argv, next, exit);
              break;
            }

            // If no builtin matched, we just spawn the process and hope it is
            // somewhere in $PATH.
            this.spawn(argv).then(next);

            break;
          }

        case ShellNodeType.AndCommand:
          {
            // First call visit() on the left-hand side of the &&-command.
            visit(command.left, exitCode => {
              if (exitCode !== 0) {
                exit(exitCode);
              } else {
                // If the first command exited successfully, call visit() on
                // the right-hand side of the &&-command.
                visit(command.right, next, exit);
              }
            }, exit);
            break;
          }

        case ShellNodeType.OrCommand:
          {
            visit(command.left, exitCode => {
              if (exitCode === 0) {
                exit(0);
              } else {
                visit(command.right, next, exit);
              }
            }, exit);
            break;
          }

        default:
          throw new Error(`Could not evaluate shell command: unknown node`);

      }

    }

    return new Promise(accept => {

      if (typeof(command) === 'string') {
        command = parseShellCommand(command);
      }

      visit(command, accept, accept);

    });

  }

}

export function evalShellCommand(command: string | ShellCommand, {
  spawn,
  cwd = process.cwd(),
  env = process.env,
  extraBuiltins = {},
  noDefaultBuiltins = false,
}: EvalShellCommandOptions): Promise<number> {

  const builtins = noDefaultBuiltins
    ? extraBuiltins
    : { ...DEFAULT_BUILTINS, ...extraBuiltins }

  const evaluator = new ShellEvaluator(
    cwd,
    env,
    builtins,
    spawn
  );

  return evaluator.eval(command);

}
