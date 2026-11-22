import { describe, it, expect } from 'vitest';
import {
  stripJsTsComments,
  stripCssComments,
  stripAstroComments,
  stripMdxComments,
  stripPythonComments,
  stripYamlComments,
  stripShellPsComments,
  stripTexComments,
  stripTypstComments,
  stripSqlComments,
  stripBatComments,
  stripHtmlComments,
  stripHashConfigComments,
  stripContentByExtension,
  stripContentForFile,
} from '../../scripts/lib/comment-stripper.mjs';

describe('Comment Stripper (Unit Tests)', () => {
  it('should strip JS/TS single-line and multi-line comments safely without corrupting literals', () => {
    const input = `
    // single line comment
    const url = "https://github.com/foo/bar"; // url inline comment
    /* multi
       line
       comment */
    const strWithCommentChars = '/* this is string */ and // still string';
    const template = \`hello \${/* expr comment */ 1 + 2} \${ \`nested \${/* nested */ 4}\` }\`;
    const regex = /\\/\\//g; // regex test
    const div = 10 / 2 / 5;
    `;

    const result = stripJsTsComments(input);
    expect(result).not.toContain('single line comment');
    expect(result).not.toContain('url inline comment');
    expect(result).not.toContain('multi\n       line');
    expect(result).not.toContain('expr comment');
    expect(result).not.toContain('nested */');
    expect(result).toContain('https://github.com/foo/bar');
    expect(result).toContain('/* this is string */ and // still string');
    expect(result).toContain('10 / 2 / 5');
    expect(result).toContain('/\\/\\//g');
  });

  it('should preserve critical JS/TS compiler, bundler, and shebang directives', () => {
    const input = `#!/usr/bin/env node
/// <reference types="node" />
// normal comment to drop
// @ts-expect-error intentional check
const mod = await import(/* @vite-ignore */ name);
/* regular block comment to drop */
/* v8 ignore next */
export const ok = true;
`;
    const result = stripJsTsComments(input);
    expect(result.startsWith('#!/usr/bin/env node')).toBe(true);
    expect(result).toContain('/// <reference types="node" />');
    expect(result).toContain('// @ts-expect-error intentional check');
    expect(result).toContain('/* @vite-ignore */');
    expect(result).toContain('/* v8 ignore next */');
    expect(result).not.toContain('normal comment to drop');
    expect(result).not.toContain('regular block comment to drop');
  });

  it('should strip CSS block comments without corrupting quoted strings', () => {
    const input = `
    /* Top level CSS comment */
    .box {
      color: red; /* inline comment */
      content: "/* quote with comment */";
    }
    `;
    const result = stripCssComments(input);
    expect(result).not.toContain('Top level CSS comment');
    expect(result).not.toContain('inline comment');
    expect(result).toContain('content: "/* quote with comment */"');
    expect(result).toContain('color: red;');
  });

  it('should strip Astro comments (frontmatter, script, style, JSX, HTML)', () => {
    const input = `---
// frontmatter comment
import Foo from './Foo.astro';
/* block comment in frontmatter */
---
<!-- HTML comment in template -->
<div class="card">
  {/* JSX comment in template */}
  <Foo />
</div>
<script>
// inline script comment
const x = 1;
</script>
<style>
/* style comment */
.card { color: inherit; }
</style>`;
    const result = stripAstroComments(input);
    expect(result).not.toContain('frontmatter comment');
    expect(result).not.toContain('block comment in frontmatter');
    expect(result).not.toContain('HTML comment in template');
    expect(result).not.toContain('JSX comment in template');
    expect(result).not.toContain('inline script comment');
    expect(result).not.toContain('style comment');
    expect(result).toContain("import Foo from './Foo.astro';");
    expect(result).toContain('<div class="card">');
    expect(result).toContain('const x = 1;');
  });

  it('should strip MDX comments without corrupting math and textbook code blocks', () => {
    const input = `---
title: "Sample MDX"
# YAML comment in frontmatter
description: "Description"
---
<!-- HTML comment in MDX body -->
{/* JSX comment in MDX */}

# Introduction

Here is some textbook content.

\`\`\`python
# This textbook code example comment MUST be preserved!
def example():
    return 42
\`\`\`

Inline \`code with // comments\` should stay intact.
`;
    const result = stripMdxComments(input);
    expect(result).not.toContain('YAML comment in frontmatter');
    expect(result).not.toContain('HTML comment in MDX body');
    expect(result).not.toContain('JSX comment in MDX');
    expect(result).toContain('# This textbook code example comment MUST be preserved!');
    expect(result).toContain('Inline `code with // comments` should stay intact.');
  });

  it('should strip Python and YAML comments safely', () => {
    const py = `#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# Top level Python comment
import sys

def foo():
    # Inside function comment
    url = "https://example.com/#anchor"
    doc = """
    Triple quote string with # hash inside
    """
    return url # Return comment
`;
    const strippedPy = stripPythonComments(py);
    expect(strippedPy.startsWith('#!/usr/bin/env python3')).toBe(true);
    expect(strippedPy).toContain('# -*- coding: utf-8 -*-');
    expect(strippedPy).not.toContain('Top level Python comment');
    expect(strippedPy).not.toContain('Inside function comment');
    expect(strippedPy).not.toContain('Return comment');
    expect(strippedPy).toContain('https://example.com/#anchor');
    expect(strippedPy).toContain('Triple quote string with # hash inside');

    const yaml = `
# Global YAML config comment
name: "AstroLib" # Inline comment
repo: "https://github.com/foo/bar#anchor"
raw_url: https://example.com/path#fragment
color: "#ffffff"
nested:
  # Nested comment
  enabled: true
`;
    const strippedYaml = stripYamlComments(yaml);
    expect(strippedYaml).not.toContain('Global YAML config comment');
    expect(strippedYaml).not.toContain('Inline comment');
    expect(strippedYaml).not.toContain('Nested comment');
    expect(strippedYaml).toContain('name: "AstroLib"');
    expect(strippedYaml).toContain('repo: "https://github.com/foo/bar#anchor"');
    expect(strippedYaml).toContain('raw_url: https://example.com/path#fragment');
    expect(strippedYaml).toContain('color: "#ffffff"');
  });

  it('should strip shell, TeX, Typst, SQL, HTML/XML, INI/TOML, BAT, JSONC and dotfiles cleanly', () => {
    const ps = `<#\nblock ps\n#>\n# line comment\n$u = "http://x#y" # tail\n`;
    const strippedPs = stripShellPsComments(ps);
    expect(strippedPs).not.toContain('block ps');
    expect(strippedPs).not.toContain('line comment');
    expect(strippedPs).not.toContain('tail');
    expect(strippedPs).toContain('$u = "http://x#y"');

    const tex = `% full line comment\n50\\% rate % trailing comment\n\\\\begin{document}\n`;
    const strippedTex = stripTexComments(tex);
    expect(strippedTex).not.toContain('full line comment');
    expect(strippedTex).not.toContain('trailing comment');
    expect(strippedTex).toContain('50\\% rate');

    const typ = `// line\n/* outer /* inner */ outer */\n#text("keep // string")\n`;
    const strippedTyp = stripTypstComments(typ);
    expect(strippedTyp).not.toContain('line');
    expect(strippedTyp).not.toContain('outer');
    expect(strippedTyp).toContain('#text("keep // string")');

    const sql = `-- head\nSELECT '-- keep' /* inline */ FROM tbl;\n`;
    const strippedSql = stripSqlComments(sql);
    expect(strippedSql).not.toContain('head');
    expect(strippedSql).not.toContain('inline');
    expect(strippedSql).toContain("SELECT '-- keep'");

    const xml = `<?xml version="1.0"?>\n<!-- drop me -->\n<svg><path d="M0 0"/></svg>\n`;
    const strippedXml = stripHtmlComments(xml);
    expect(strippedXml).toContain('<?xml version="1.0"?>');
    expect(strippedXml).not.toContain('drop me');

    const gitignore = `# local secret ignore\n.env.*\n!.env.example\n`;
    const strippedGi = stripContentForFile(gitignore, '.gitignore');
    expect(strippedGi).not.toContain('local secret ignore');
    expect(strippedGi).toContain('.env.*\n!.env.example');

    const ini = `; semicolon\n# hash\nkey = val ; inline\n`;
    const strippedIni = stripHashConfigComments(ini, true);
    expect(strippedIni).not.toContain('semicolon');
    expect(strippedIni).not.toContain('hash');
    expect(strippedIni).not.toContain('inline');
    expect(strippedIni).toContain('key = val');

    const bat = `@echo off\nREM remove me\n:: also remove\necho ok\n`;
    const strippedBat = stripBatComments(bat);
    expect(strippedBat).not.toContain('remove me');
    expect(strippedBat).not.toContain('also remove');
    expect(strippedBat).toContain('echo ok');

    const jsonCommented = `{\n  // comment in tsconfig\n  "compilerOptions": { "strict": true }\n}\n`;
    const strippedJson = stripContentForFile(jsonCommented, 'tsconfig.json');
    expect(strippedJson).not.toContain('comment in tsconfig');
    expect(() => JSON.parse(strippedJson)).not.toThrow();

    const validJson = `{"comment": "// keep literal string"}\n`;
    expect(stripContentForFile(validJson, 'package.json')).toBe(validJson);
  });

  it('should dispatch by file extension cleanly', () => {
    expect(stripContentByExtension('// comment\nconst a = 1;', '.js')).toBe('const a = 1;\n');
    expect(stripContentByExtension('/* comment */ body { margin: 0; }', '.css')).toBe('body { margin: 0; }\n');
  });
});
