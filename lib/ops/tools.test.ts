import { describe, expect, it } from 'vitest'
import { OPS_TOOLS, isStrictCompatibleSchema, toAnthropicTool, type OpsTool } from './tools'

describe('Ops tool schemas', () => {
  it('are all compatible with strict tool use', () => {
    const incompatible = OPS_TOOLS.filter((tool) => !isStrictCompatibleSchema(tool.inputSchema))
    expect(incompatible.map((tool) => tool.name)).toEqual([])
  })

  it('have unique names', () => {
    const names = OPS_TOOLS.map((tool) => tool.name)
    expect(new Set(names).size).toBe(names.length)
  })
})

describe('toAnthropicTool', () => {
  it('passes the name, description and schema through unchanged and sets strict', () => {
    for (const tool of OPS_TOOLS) {
      const converted = toAnthropicTool(tool)
      expect(converted).toEqual({
        name: tool.name,
        description: tool.description,
        input_schema: tool.inputSchema,
        strict: true,
      })
      // Wire format only: never the handler, never eager input streaming.
      expect(converted).not.toHaveProperty('handler')
      expect(converted).not.toHaveProperty('eager_input_streaming')
    }
  })

  it('leaves strict off when a schema uses a keyword strict mode rejects', () => {
    const tool: OpsTool = {
      name: 'ranged',
      description: 'Has a numeric bound',
      inputSchema: {
        type: 'object',
        properties: { days: { type: 'number', minimum: 1 } },
        additionalProperties: false,
      },
      handler: async () => null,
    }
    expect(toAnthropicTool(tool)).not.toHaveProperty('strict')
  })
})

describe('isStrictCompatibleSchema', () => {
  const ok = {
    type: 'object',
    properties: {
      id: { type: 'string', format: 'uuid', description: 'Id' },
      tags: { type: 'array', items: { type: 'string', enum: ['a', 'b'] } },
      nested: {
        type: 'object',
        properties: { flag: { type: ['boolean', 'null'] } },
        required: ['flag'],
        additionalProperties: false,
      },
      either: { anyOf: [{ type: 'string' }, { type: 'integer' }] },
    },
    required: ['id'],
    additionalProperties: false,
  }

  it('accepts supported types, formats, enums, arrays, nested objects and anyOf', () => {
    expect(isStrictCompatibleSchema(ok)).toBe(true)
  })

  it('requires an object root', () => {
    expect(isStrictCompatibleSchema({ type: 'string' })).toBe(false)
    expect(isStrictCompatibleSchema(null)).toBe(false)
    expect(isStrictCompatibleSchema([])).toBe(false)
  })

  it('requires additionalProperties: false on every object', () => {
    expect(isStrictCompatibleSchema({ type: 'object', properties: {} })).toBe(false)
    expect(
      isStrictCompatibleSchema({
        ...ok,
        properties: { nested: { type: 'object', properties: {}, additionalProperties: true } },
      })
    ).toBe(false)
  })

  it.each([
    ['minimum', { type: 'number', minimum: 1 }],
    ['maximum', { type: 'number', maximum: 10 }],
    ['minLength', { type: 'string', minLength: 1 }],
    ['maxLength', { type: 'string', maxLength: 10 }],
    ['pattern', { type: 'string', pattern: '^a' }],
    ['unsupported format', { type: 'string', format: 'credit-card' }],
    ['unknown type', { type: 'decimal' }],
    ['$ref', { $ref: '#/$defs/x' }],
  ])('rejects %s', (_label, property) => {
    expect(
      isStrictCompatibleSchema({
        type: 'object',
        properties: { field: property },
        additionalProperties: false,
      })
    ).toBe(false)
  })

  it('rejects required names that are not declared properties', () => {
    expect(
      isStrictCompatibleSchema({
        type: 'object',
        properties: {},
        required: ['missing'],
        additionalProperties: false,
      })
    ).toBe(false)
  })
})
