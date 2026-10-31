/** Remark plugin for GitHub's backtick inline math, $`...`$, emitting the node remark-math emits for $...$. */

const DOLLAR = 36
const BACKTICK = 96

// micromark encodes every line ending as a negative code below -2, and the end of input as null.
const isLineEnding = code => code !== null && code < -2

const mathBacktickConstruct = { name: 'mathBacktick', tokenize: tokenizeMathBacktick }

/** Register the construct and its mdast handlers; register after remark-math so `$` tries this first. */
export default function remarkMathBacktick() {
  const data = this.data()
  data.micromarkExtensions ??= []
  data.fromMarkdownExtensions ??= []
  data.micromarkExtensions.push({ text: { [DOLLAR]: mathBacktickConstruct } })
  data.fromMarkdownExtensions.push({
    enter: { mathBacktick: enterMathBacktick },
    exit: { mathBacktick: exitMathBacktick, mathBacktickData: exitMathBacktickData },
  })
}

function tokenizeMathBacktick(effects, ok, nok) {
  let openSize = 0
  let closeSize = 0

  return start

  function start(code) {
    effects.enter('mathBacktick')
    effects.enter('mathBacktickSequence')
    effects.consume(code)
    return openTicks
  }

  function openTicks(code) {
    if (code === BACKTICK) {
      effects.consume(code)
      openSize++
      return openTicks
    }
    if (openSize === 0) {
      return nok(code)
    }
    effects.exit('mathBacktickSequence')
    return contentStart(code)
  }

  function contentStart(code) {
    if (code === null || isLineEnding(code) || code === BACKTICK) {
      return nok(code)
    }
    effects.enter('mathBacktickData')
    return content(code)
  }

  function content(code) {
    if (code === null || isLineEnding(code)) {
      return nok(code)
    }
    if (code === BACKTICK) {
      return effects.check({ tokenize: tokenizeClose }, closeFound, inner)(code)
    }
    effects.consume(code)
    return content
  }

  function inner(code) {
    if (code === BACKTICK) {
      effects.consume(code)
      return inner
    }
    return content(code)
  }

  function closeFound(code) {
    effects.exit('mathBacktickData')
    effects.enter('mathBacktickSequence')
    return closeTicks(code)
  }

  function closeTicks(code) {
    if (code === BACKTICK) {
      effects.consume(code)
      return closeTicks
    }
    effects.consume(code)
    effects.exit('mathBacktickSequence')
    effects.exit('mathBacktick')
    return ok
  }

  function tokenizeClose(effects, ok, nok) {
    return run

    function run(code) {
      if (code === BACKTICK) {
        effects.consume(code)
        closeSize++
        return run
      }
      const matches = closeSize === openSize && code === DOLLAR
      closeSize = 0
      return matches ? ok(code) : nok(code)
    }
  }
}

function enterMathBacktick(token) {
  this.enter(
    {
      type: 'inlineMath',
      value: '',
      data: {
        hName: 'code',
        hProperties: { className: ['language-math', 'math-inline'] },
        hChildren: [],
      },
    },
    token,
  )
  this.buffer()
}

function exitMathBacktickData(token) {
  this.config.enter.data.call(this, token)
  this.config.exit.data.call(this, token)
}

function exitMathBacktick(token) {
  const value = this.resume().trim()
  const node = this.stack[this.stack.length - 1]
  this.exit(token)
  node.value = value
  node.data.hChildren.push({ type: 'text', value })
}
