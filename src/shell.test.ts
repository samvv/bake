
import test from "ava";
import {
  ShellNodeType,
  parseShellCommand,
  TextShellExpr,
  RefShellExpr,
  SpawnShellCommand,
  AndShellCommand,
  OrShellCommand
} from "./shell";

test("a shell command parser can parse a very simple command with a few arguments", t => {
  const command = parseShellCommand("foo bar bax")
  const args = (command as SpawnShellCommand).args;
  t.assert(args.length === 3);
  t.assert(args[0].length === 1);
  t.assert(args[0][0].type === ShellNodeType.TextExpr);
  t.assert((args[0][0] as TextShellExpr).text === "foo");
  t.assert(args[1].length === 1);
  t.assert(args[1][0].type === ShellNodeType.TextExpr);
  t.assert((args[1][0] as TextShellExpr).text === "bar");
  t.assert(args[2].length === 1);
  t.assert(args[2][0].type === ShellNodeType.TextExpr);
  t.assert((args[2][0] as TextShellExpr).text === "bax");
});

test("a shell command parser can parse a simple command", t => {
  const command = parseShellCommand("git-filter-branch")
  const args = (command as SpawnShellCommand).args;
  t.assert(args.length === 1);
  t.assert(args[0].length === 1);
  t.assert(args[0][0].type === ShellNodeType.TextExpr);
  t.assert((args[0][0] as TextShellExpr).text === "git-filter-branch");
});

test("a shell command parser can parse a command with shell variables", t => {
  const command = parseShellCommand("cp $HOME/my-app /app");
  const args = (command as SpawnShellCommand).args;
  t.assert(args.length === 3);
  t.assert(args[0].length === 1);
  t.assert(args[0][0].type === ShellNodeType.TextExpr);
  t.assert((args[0][0] as TextShellExpr).text === "cp");
  t.assert(args[1].length === 2);
  t.assert(args[1][0].type === ShellNodeType.RefExpr);
  t.assert((args[1][0] as RefShellExpr).name === 'HOME');
  t.assert(args[1][1].type === ShellNodeType.TextExpr);
  t.assert((args[1][1] as TextShellExpr).text === '/my-app');
  t.assert(args[2].length === 1);
  t.assert(args[2][0].type === ShellNodeType.TextExpr);
  t.assert((args[2][0] as TextShellExpr).text === "/app");
});

test("a shell command parser can parse the &&-operator", t => {
  const command = parseShellCommand("first a b c && second one two three") as AndShellCommand;
  t.assert(command.type === ShellNodeType.AndCommand);
  const left = command.left as SpawnShellCommand;
  t.assert(left.type === ShellNodeType.SpawnCommand);
  t.assert(left.args.length === 4);
  const right = command.right as SpawnShellCommand;
  t.assert(right.type === ShellNodeType.SpawnCommand);
  t.assert(right.args.length === 4);
  const secondArg = right.args[0][0] as TextShellExpr;
  t.assert(secondArg.text === "second");
  const oneExpr = right.args[1][0] as TextShellExpr;
  t.assert(oneExpr.text === "one");
  const twoExpr = right.args[2][0] as TextShellExpr;
  t.assert(twoExpr.text === "two");
  const threeExpr = right.args[3][0] as TextShellExpr;
  t.assert(threeExpr.text === "three");
});


test("a shell command parser parses all binary operators as being left-associative", t => {
  const bin1 = parseShellCommand("first && second || third && fourth") as AndShellCommand;
  t.assert(bin1.type === ShellNodeType.AndCommand);
  const c4 = bin1.right as SpawnShellCommand;
  t.assert(c4.type === ShellNodeType.SpawnCommand);
  t.assert((c4.args[0][0] as TextShellExpr).text === 'fourth');
  const bin2 = bin1.left as OrShellCommand;
  t.assert(bin2.type === ShellNodeType.OrCommand);
  const c3 = bin2.right as SpawnShellCommand;
  t.assert(c3.type === ShellNodeType.SpawnCommand);
  t.assert((c3.args[0][0] as TextShellExpr).text === 'third');
  const bin3 = bin2.left as AndShellCommand;
  t.assert(bin3.type === ShellNodeType.AndCommand);
  const c2 = bin3.right as SpawnShellCommand;
  t.assert(c2.type === ShellNodeType.SpawnCommand);
  t.assert((c2.args[0][0] as TextShellExpr).text === 'second');
  const c1 = bin3.left as SpawnShellCommand;
  t.assert(c1.type === ShellNodeType.SpawnCommand);
  t.assert((c1.args[0][0] as TextShellExpr).text === 'first');
});
