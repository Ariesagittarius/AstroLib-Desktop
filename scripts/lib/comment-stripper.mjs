import fs from 'node:fs';
import path from 'node:path';

function isPreservedJsDirective(commentText) {
  const trimmed = commentText.trim();
  return (
    /^\/\/\/\s*<reference\b/i.test(trimmed) ||
    /^\/\/\s*@ts-(?:ignore|expect-error|nocheck|check)\b/.test(trimmed) ||
    /^\/\*\s*(?:@vite-ignore|c8\s+ignore|v8\s+ignore)\b/.test(trimmed)
  );
}

export function stripJsTsComments(code, options = {}) {
  const preserveDirectives = options.preserveDirectives ?? true;
  const nestedBlockComments = options.nestedBlockComments ?? false;
  let output = '';
  const len = code.length;
  let i = 0;

  if (code.startsWith('#!')) {
    while (i < len && code[i] !== '\n' && code[i] !== '\r') {
      output += code[i];
      i++;
    }
  }

  const stateStack = [];

  while (i < len) {
    const ch = code[i];
    const next = i + 1 < len ? code[i + 1] : '';
    const currentState = stateStack.length > 0 ? stateStack[stateStack.length - 1] : 'DEFAULT';

    if (currentState === 'DEFAULT' || currentState === 'TEMPLATE_EXPR') {

      if (ch === '{' && code.slice(i, i + 3) === '{/*') {
        const end = code.indexOf('*/}', i + 3);
        if (end >= 0) {
          i = end + 3;
          continue;
        }
      }

      if (ch === '/' && next === '/') {
        const start = i;
        i += 2;
        while (i < len && code[i] !== '\n' && code[i] !== '\r') {
          i++;
        }
        const rawComment = code.slice(start, i);
        if (preserveDirectives && isPreservedJsDirective(rawComment)) {
          output += rawComment;
        }
        continue;
      }

      if (ch === '/' && next === '*') {
        const start = i;
        i += 2;
        let depth = 1;
        while (i < len && depth > 0) {
          if (nestedBlockComments && code[i] === '/' && code[i + 1] === '*') {
            depth++;
            i += 2;
          } else if (code[i] === '*' && code[i + 1] === '/') {
            depth--;
            i += 2;
          } else {
            i++;
          }
        }
        const rawComment = code.slice(start, i);
        if (preserveDirectives && isPreservedJsDirective(rawComment)) {
          output += rawComment;
        }
        continue;
      }

      if (ch === "'") {
        output += ch;
        i++;
        while (i < len) {
          const c = code[i];
          output += c;
          if (c === '\\' && i + 1 < len) {
            i++;
            output += code[i];
          } else if (c === "'") {
            i++;
            break;
          }
          i++;
        }
        continue;
      }

      if (ch === '"') {
        output += ch;
        i++;
        while (i < len) {
          const c = code[i];
          output += c;
          if (c === '\\' && i + 1 < len) {
            i++;
            output += code[i];
          } else if (c === '"') {
            i++;
            break;
          }
          i++;
        }
        continue;
      }

      if (ch === '`') {
        output += ch;
        i++;
        stateStack.push('TEMPLATE_LITERAL');
        continue;
      }

      if (ch === '/') {
        if (isRegExpStart(output)) {
          output += ch;
          i++;
          let inCharClass = false;
          while (i < len) {
            const c = code[i];
            output += c;
            if (c === '\\' && i + 1 < len) {
              i++;
              output += code[i];
            } else if (c === '[') {
              inCharClass = true;
            } else if (c === ']' && inCharClass) {
              inCharClass = false;
            } else if (c === '/' && !inCharClass) {
              i++;
              while (i < len && /[a-z]/i.test(code[i])) {
                output += code[i];
                i++;
              }
              break;
            }
            i++;
          }
          continue;
        }
      }

      if (currentState === 'TEMPLATE_EXPR' && ch === '}') {
        stateStack.pop();
        output += ch;
        i++;
        continue;
      }

      output += ch;
      i++;
    } else if (currentState === 'TEMPLATE_LITERAL') {
      if (ch === '\\' && i + 1 < len) {
        output += ch + next;
        i += 2;
      } else if (ch === '$' && next === '{') {
        output += '${';
        i += 2;
        stateStack.push('TEMPLATE_EXPR');
      } else if (ch === '`') {
        output += ch;
        i++;
        stateStack.pop();
      } else {
        output += ch;
        i++;
      }
    }
  }

  return cleanEmptyLines(output);
}

function isRegExpStart(prevOutput) {
  const trimmed = prevOutput.trimEnd();
  if (!trimmed) return true;
  const lastChar = trimmed[trimmed.length - 1];

  if (/[=(,;:[?!&|{}><+*~%^-]/.test(lastChar)) {
    return true;
  }

  const match = trimmed.match(/\b(return|typeof|instanceof|case|yield|await|throw|void|delete|else|in|of)$/);
  return Boolean(match);
}

export function stripCssComments(css) {
  let output = '';
  const len = css.length;
  let i = 0;

  while (i < len) {
    const ch = css[i];
    const next = i + 1 < len ? css[i + 1] : '';

    if (ch === '"' || ch === "'") {
      const quote = ch;
      output += quote;
      i++;
      while (i < len) {
        const c = css[i];
        output += c;
        if (c === '\\' && i + 1 < len) {
          i++;
          output += css[i];
        } else if (c === quote) {
          i++;
          break;
        }
        i++;
      }
      continue;
    }

    if (ch === '/' && next === '*') {
      i += 2;
      while (i < len && !(css[i] === '*' && i + 1 < len && css[i + 1] === '/')) {
        i++;
      }
      i += 2;
      continue;
    }

    output += ch;
    i++;
  }

  return cleanEmptyLines(output);
}

export function stripScssLessComments(code) {
  return stripJsTsComments(code, { preserveDirectives: false });
}

export function stripHtmlComments(html) {
  return cleanEmptyLines(html.replace(/<!--(?!\s*\[if\b)[\s\S]*?-->/gi, ''));
}

export function stripAstroComments(content) {
  let result = content;

  const fmMatch = result.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (fmMatch) {
    const rawFm = fmMatch[1];
    const strippedFm = stripJsTsComments(rawFm);
    result = `---\n${strippedFm.trim()}\n---` + result.slice(fmMatch[0].length);
  }

  const placeholders = [];
  result = result.replace(/(<style(?:\s[^>]*)?>)([\s\S]*?)(<\/style>)/gi, (_, open, body, close) => {
    const token = `___ASTRO_STRIP_BLOCK_${placeholders.length}___`;
    placeholders.push(open + stripCssComments(body) + close);
    return token;
  });

  result = result.replace(/(<script(?:\s[^>]*)?>)([\s\S]*?)(<\/script>)/gi, (_, open, body, close) => {
    const token = `___ASTRO_STRIP_BLOCK_${placeholders.length}___`;
    placeholders.push(open + stripJsTsComments(body) + close);
    return token;
  });

  result = result.replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
  result = result.replace(/<!--[\s\S]*?-->/g, '');
  result = result.replace(/___ASTRO_STRIP_BLOCK_(\d+)___/g, (_, idx) => placeholders[Number(idx)] ?? '');

  return cleanEmptyLines(result);
}

export function stripMdxComments(content) {
  const codeBlockRegex = /(```[\s\S]*?```|`[^`\n]+`)/g;
  const parts = [];
  let lastIndex = 0;
  let match;

  while ((match = codeBlockRegex.exec(content)) !== null) {
    parts.push({ type: 'text', content: content.slice(lastIndex, match.index) });
    parts.push({ type: 'code', content: match[0] });
    lastIndex = codeBlockRegex.lastIndex;
  }
  if (lastIndex < content.length) {
    parts.push({ type: 'text', content: content.slice(lastIndex) });
  }

  const processed = parts.map((part) => {
    if (part.type === 'code') {
      return part.content;
    }
    let text = part.content;

    const fmMatch = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (fmMatch) {
      const strippedFm = stripYamlComments(fmMatch[1]);
      text = `---\n${strippedFm.trim()}\n---` + text.slice(fmMatch[0].length);
    }

    text = text.replace(/<!--[\s\S]*?-->/g, '');
    text = text.replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

    return text;
  });

  return cleanEmptyLines(processed.join(''));
}

export function stripPythonComments(code) {
  let output = '';
  const len = code.length;
  let i = 0;

  while (i < len) {
    const ch = code[i];

    if ((ch === "'" || ch === '"') && i + 2 < len && code[i + 1] === ch && code[i + 2] === ch) {
      const triple = ch + ch + ch;
      output += triple;
      i += 3;
      while (i < len) {
        if (code[i] === '\\' && i + 1 < len) {
          output += code[i] + code[i + 1];
          i += 2;
        } else if (code.slice(i, i + 3) === triple) {
          output += triple;
          i += 3;
          break;
        } else {
          output += code[i];
          i++;
        }
      }
      continue;
    }

    if (ch === "'" || ch === '"') {
      const quote = ch;
      output += quote;
      i++;
      while (i < len) {
        const c = code[i];
        output += c;
        if (c === '\\' && i + 1 < len) {
          i++;
          output += code[i];
        } else if (c === quote) {
          i++;
          break;
        }
        i++;
      }
      continue;
    }

    if (ch === '#') {
      const lineStart = output.lastIndexOf('\n') + 1;
      const currentLine = code.slice(lineStart, code.indexOf('\n', i) === -1 ? len : code.indexOf('\n', i));
      const isShebang = i === 0 && code.slice(0, 2) === '#!';
      const isEncodingCookie =
        (lineStart === 0 || code.slice(0, lineStart).split(/\r?\n/).length <= 2) &&
        /^#.*coding[:=]\s*[-\w.]+/i.test(currentLine);

      if (isShebang || isEncodingCookie) {
        while (i < len && code[i] !== '\n' && code[i] !== '\r') {
          output += code[i];
          i++;
        }
        continue;
      }

      while (i < len && code[i] !== '\n' && code[i] !== '\r') {
        i++;
      }
      continue;
    }

    output += ch;
    i++;
  }

  return cleanEmptyLines(output);
}

export function stripYamlComments(yaml) {
  const lines = yaml.split(/\r?\n/);
  const resultLines = [];

  for (const line of lines) {
    let inSingle = false;
    let inDouble = false;
    let cutIndex = -1;

    for (let j = 0; j < line.length; j++) {
      const c = line[j];
      if (inDouble && c === '\\' && j + 1 < line.length) {
        j++;
        continue;
      }
      if (c === "'" && !inDouble) {
        if (inSingle && line[j + 1] === "'") {
          j++;
          continue;
        }
        inSingle = !inSingle;
      } else if (c === '"' && !inSingle) {
        inDouble = !inDouble;
      } else if (c === '#' && !inSingle && !inDouble) {
        if (j === 0 || line[j - 1] === ' ' || line[j - 1] === '\t') {
          cutIndex = j;
          break;
        }
      }
    }

    if (cutIndex === 0) {
      continue;
    }
    const cleaned = cutIndex > 0 ? line.slice(0, cutIndex).trimEnd() : line;
    resultLines.push(cleaned);
  }

  return cleanEmptyLines(resultLines.join('\n'));
}

export function stripShellPsComments(code) {
  let cleaned = code.replace(/<#[\s\S]*?#>/g, '');
  const lines = cleaned.split(/\r?\n/);
  const resultLines = [];

  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx];
    if (idx === 0 && line.startsWith('#!')) {
      resultLines.push(line);
      continue;
    }

    let inSingle = false;
    let inDouble = false;
    let cutIndex = -1;

    for (let j = 0; j < line.length; j++) {
      const c = line[j];
      if ((inDouble || (!inSingle && !inDouble)) && c === '\\' && j + 1 < line.length) {
        j++;
        continue;
      }
      if (c === "'" && !inDouble) {
        inSingle = !inSingle;
      } else if (c === '"' && !inSingle) {
        inDouble = !inDouble;
      } else if (c === '#' && !inSingle && !inDouble) {
        if (j === 0 || line[j - 1] === ' ' || line[j - 1] === '\t') {
          cutIndex = j;
          break;
        }
      }
    }

    if (cutIndex === 0) {
      continue;
    }
    resultLines.push(cutIndex > 0 ? line.slice(0, cutIndex).trimEnd() : line);
  }

  return cleanEmptyLines(resultLines.join('\n'));
}

export function stripTexComments(code) {
  const lines = code.split(/\r?\n/);
  const out = [];

  for (const line of lines) {
    let cutIndex = -1;
    for (let j = 0; j < line.length; j++) {
      if (line[j] === '%') {
        let backslashes = 0;
        let k = j - 1;
        while (k >= 0 && line[k] === '\\') {
          backslashes++;
          k--;
        }
        if (backslashes % 2 === 0) {
          cutIndex = j;
          break;
        }
      }
    }
    if (cutIndex === 0) {
      continue;
    }
    out.push(cutIndex > 0 ? line.slice(0, cutIndex).trimEnd() : line);
  }

  return cleanEmptyLines(out.join('\n'));
}

export function stripTypstComments(code) {
  return stripJsTsComments(code, { preserveDirectives: false, nestedBlockComments: true });
}

export function stripHashConfigComments(code, allowSemicolon = false) {
  const lines = code.split(/\r?\n/);
  const out = [];

  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx];
    if (idx === 0 && line.startsWith('#!')) {
      out.push(line);
      continue;
    }

    let inSingle = false;
    let inDouble = false;
    let cutIndex = -1;

    for (let j = 0; j < line.length; j++) {
      const c = line[j];
      if (inDouble && c === '\\' && j + 1 < line.length) {
        j++;
        continue;
      }
      if (c === "'" && !inDouble) {
        inSingle = !inSingle;
      } else if (c === '"' && !inSingle) {
        inDouble = !inDouble;
      } else if ((c === '#' || (allowSemicolon && c === ';')) && !inSingle && !inDouble) {
        if (j === 0 || line[j - 1] === ' ' || line[j - 1] === '\t') {
          cutIndex = j;
          break;
        }
      }
    }

    if (cutIndex === 0) {
      continue;
    }
    out.push(cutIndex > 0 ? line.slice(0, cutIndex).trimEnd() : line);
  }

  return cleanEmptyLines(out.join('\n'));
}

export function stripSqlComments(code) {
  let output = '';
  const len = code.length;
  let i = 0;

  while (i < len) {
    const ch = code[i];
    const next = i + 1 < len ? code[i + 1] : '';

    if (ch === "'" || ch === '"') {
      const quote = ch;
      output += quote;
      i++;
      while (i < len) {
        const c = code[i];
        output += c;
        if (c === quote && code[i + 1] === quote) {
          i++;
          output += code[i];
        } else if (c === '\\' && i + 1 < len) {
          i++;
          output += code[i];
        } else if (c === quote) {
          i++;
          break;
        }
        i++;
      }
      continue;
    }

    if (ch === '-' && next === '-') {
      i += 2;
      while (i < len && code[i] !== '\n' && code[i] !== '\r') {
        i++;
      }
      continue;
    }

    if (ch === '/' && next === '*') {
      i += 2;
      while (i < len && !(code[i] === '*' && code[i + 1] === '/')) {
        i++;
      }
      i += 2;
      continue;
    }

    output += ch;
    i++;
  }

  return cleanEmptyLines(output);
}

export function stripBatComments(code) {
  const lines = code.split(/\r?\n/);
  const out = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (/^@?REM(?:\s|$)/i.test(trimmed) || trimmed.startsWith('::')) {
      continue;
    }
    out.push(line);
  }
  return cleanEmptyLines(out.join('\n'));
}

function cleanEmptyLines(text) {
  const cleaned = text
    .replace(/[ \t]+$/gm, '')
    .replace(/(\r?\n){3,}/g, '\n\n')
    .trim();
  return cleaned ? `${cleaned}\n` : '';
}

const HASH_CONFIG_BASENAMES = new Set([
  '.gitignore',
  '.gitattributes',
  '.editorconfig',
  '.dockerignore',
  '.npmrc',
  '.prettierignore',
  '.eslintignore',
  '.env.example',
]);

export function stripContentByExtension(content, ext) {
  const normalizedExt = ext.toLowerCase().replace(/^\./, '');

  switch (normalizedExt) {
    case 'js':
    case 'mjs':
    case 'cjs':
    case 'ts':
    case 'mts':
    case 'cts':
    case 'jsx':
    case 'tsx':
      return stripJsTsComments(content, { preserveDirectives: true });

    case 'jsonc':
      return stripJsTsComments(content, { preserveDirectives: false });

    case 'json':
      try {
        JSON.parse(content);
        return content;
      } catch {
        return stripJsTsComments(content, { preserveDirectives: false });
      }

    case 'css':
      return stripCssComments(content);

    case 'scss':
    case 'less':
      return stripScssLessComments(content);

    case 'astro':
      return stripAstroComments(content);

    case 'md':
    case 'mdx':
      return stripMdxComments(content);

    case 'py':
      return stripPythonComments(content);

    case 'yml':
    case 'yaml':
      return stripYamlComments(content);

    case 'sh':
    case 'bash':
    case 'ps1':
      return stripShellPsComments(content);

    case 'html':
    case 'xml':
    case 'xhtml':
    case 'svg':
    case 'plist':
      return stripHtmlComments(content);

    case 'typ':
      return stripTypstComments(content);

    case 'tex':
    case 'sty':
    case 'cls':
      return stripTexComments(content);

    case 'toml':
    case 'conf':
    case 'gitignore':
    case 'dockerignore':
    case 'npmrc':
    case 'env':
      return stripHashConfigComments(content, false);

    case 'ini':
    case 'cfg':
    case 'editorconfig':
      return stripHashConfigComments(content, true);

    case 'sql':
      return stripSqlComments(content);

    case 'bat':
    case 'cmd':
      return stripBatComments(content);

    default:
      return content;
  }
}

export function stripContentForFile(content, filePath) {
  const baseName = path.basename(filePath).toLowerCase();
  if (HASH_CONFIG_BASENAMES.has(baseName)) {
    const allowSemicolon = baseName === '.editorconfig';
    return stripHashConfigComments(content, allowSemicolon);
  }
  const ext = path.extname(baseName);
  if (!ext) {
    return content;
  }
  return stripContentByExtension(content, ext);
}

export function stripFile(filePath) {
  const original = fs.readFileSync(filePath, 'utf8');
  const stripped = stripContentForFile(original, filePath);
  if (original !== stripped) {
    fs.writeFileSync(filePath, stripped, 'utf8');
    return true;
  }
  return false;
}
