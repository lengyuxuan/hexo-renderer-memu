interface BlockAttributes {
  [key: string]: any;
}

type NodeType = 'stringInQuotes' | 'stringWithBrackets' | 'word' | 'array';
type Node = [any, number, NodeType];

const normalizeValue = (value: string): boolean | number | string => {
  // boolean
  if (value.toLowerCase() === 'true') {
    return true;
  } else if (value.toLowerCase() === 'false') {
    return false;
  } else if (!isNaN(value as any)) {
    // number
    return parseFloat(value as any);
  }

  return value;
};

const extractStringWithBrackets = (text, start): Node | void => {
  if (text[start] !== '(') {
    return;
  }
  let bracketDepth = 1;
  let end = start + 1;
  while (end < text.length) {
    if (text[end] === '(') {
      bracketDepth += 1;
    } else if (text[end] === ')') {
      bracketDepth -= 1;
    }
    end += 1;
    if (bracketDepth === 0) {
      break;
    }
  }

  return [text.substring(start, end), end, 'stringWithBrackets'];
};

const extractStringInQuotes = (text, start): Node | void => {
  const quote = text[start];
  if (!'\'"`'.includes(quote)) {
    return;
  }
  let end = start + 1;
  const chars: string[] = [];
  while (end < text.length) {
    if (text[end] === '\\') {
      if (end + 1 < text.length) {
        chars.push(text[end + 1]);
      }
      end += 2;
      continue;
    }
    if (text[end] === quote) {
      end += 1;
      break;
    }
    chars.push(text[end]);
    end += 1;
  }

  return [chars.join(''), end, 'stringInQuotes'];
};

const wordCharRegExp = /^[^,;=\s]$/;

const extractWord = (text: string, start: number): Node | void => {
  let i = start;
  let bracketDepth = 0;
  while (i < text.length) {
    const char = text[i];
    if (!wordCharRegExp.test(char)) {
      break;
    }
    if (char === '[') {
      bracketDepth += 1;
    } else if (char === ']') {
      bracketDepth -= 1;
    }
    if (bracketDepth < 0) {
      break;
    }
    i += 1;
  }
  if (i === start) {
    return;
  }

  return [text.substring(start, i), i, 'word'];
};

const extractArray = (text, start): Node | void => {
  if (text[start] !== '[') {
    return;
  }
  const result: any[] = [];
  let i = start + 1;
  while (i < text.length) {
    const char = text[i];
    if (char === ']') {
      i += 1;
      break;
    }

    const node: Node | void =
      extractArray(text, i) ||
      extractStringWithBrackets(text, i) ||
      extractStringInQuotes(text, i) ||
      extractWord(text, i);
    if (node) {
      const [rawValue, subEnd, nodeType] = node;
      const value = nodeType === 'word' ? normalizeValue(rawValue) : rawValue;
      i = subEnd;
      result.push(value);
    } else {
      i += 1;
    }
  }

  return [result, i, 'array'];
};

/**
 * Parses block attributes
 * @param text e.g. {#identifier .class1 .class2 key1=value1 key2=value2}
 */
export const parseBlockAttributes = (text?: string): BlockAttributes => {
  // remove surrounding { } if exist
  let textToParse = (text || '').trim();
  if (textToParse[0] === '{' && textToParse[textToParse.length - 1] === '}') {
    textToParse = textToParse.slice(1, -1);
  }

  const output: BlockAttributes = {};
  let pendingKey: string | undefined;
  let i = 0;
  while (i < textToParse.length) {
    const node: Node | void =
      extractArray(textToParse, i) ||
      extractStringWithBrackets(textToParse, i) ||
      extractStringInQuotes(textToParse, i) ||
      extractWord(textToParse, i);
    if (node) {
      const keyIsPending = typeof pendingKey === 'string';
      const [rawValue, subEnd, nodeType] = node;
      const value =
        nodeType === 'word' && keyIsPending
          ? normalizeValue(rawValue)
          : rawValue;
      i = subEnd;
      if (keyIsPending) {
        output[pendingKey!] = value;
        pendingKey = undefined;
      } else if (textToParse[i] === '=') {
        pendingKey = value;
      } else {
        const firstChar = value[0];
        let specialAttribute;
        switch (firstChar) {
          case '.':
            specialAttribute = 'class';
            break;
          case '#':
            specialAttribute = 'id';
            break;
        }
        if (specialAttribute) {
          const specialValue = value.substring(1);
          if (specialValue.length) {
            const previousValue = output[specialAttribute];
            output[specialAttribute] =
              typeof previousValue === 'undefined'
                ? specialValue
                : `${ previousValue } ${ specialValue }`;
          }
        } else {
          if (typeof value === 'string') {
            output[value] = true;
          }
        }
      }
    } else {
      // just skipping one character if it is not known for soft error handling
      i += 1;
    }
  }

  return output;
};

const stringifyArray = (value: any[]) => {
  const parts = ['['];
  value.forEach((v, i) => {
    if (v instanceof Array) {
      parts.push(stringifyArray(v));
    } else {
      parts.push(JSON.stringify(v));
    }
    if (i + 1 !== value.length) {
      parts.push(', ');
    }
  });
  parts.push(']');

  return parts.join('');
};

/**
 * Convert attributes as JSON object to attributes as string
 * @param attributes
 */
export const stringifyBlockAttributes = (
  attributes: BlockAttributes,
  addCurlyBrackets = false,
): string => {
  const parts: string[] = [];
  for (const key in attributes) {
    if (Object.prototype.hasOwnProperty.call(attributes, key)) {
      parts.push(' ');
      parts.push(`${key}=`);
      const value = attributes[key];
      if (value instanceof Array) {
        parts.push(stringifyArray(value));
      } else {
        parts.push(JSON.stringify(value));
      }
    }
  }
  parts.shift();
  if (addCurlyBrackets) {
    parts.unshift('{');
    parts.push('}');
  }

  return parts.join('');
};
