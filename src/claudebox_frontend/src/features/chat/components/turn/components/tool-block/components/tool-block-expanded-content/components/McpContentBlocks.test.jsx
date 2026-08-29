/** Tests for McpContentBlocks. */

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import McpContentBlocks from './McpContentBlocks'

vi.mock('@uiw/react-json-view', () => ({
  default: ({ value }) => <div data-testid="json-view">{JSON.stringify(value)}</div>,
}))

vi.mock('@uiw/react-json-view/dark', () => ({
  darkTheme: {},
}))

describe('McpContentBlocks', () => {
  describe('text blocks', () => {
    it('renders a prose text block as text, no JSON tree', () => {
      const { container } = render(
        <McpContentBlocks
          toolName="mcp__server__tool"
          blocks={[{ type: 'text', text: 'plain result' }]}
        />,
      )

      expect(screen.getByText('plain result')).toBeInTheDocument()
      expect(container.querySelector('[data-testid="json-view"]')).not.toBeInTheDocument()
    })

    it('renders a markdown text block via the markdown path', () => {
      const { container } = render(
        <McpContentBlocks
          toolName="mcp__server__tool"
          blocks={[{ type: 'text', text: '# Results\n\n- alpha\n- beta' }]}
        />,
      )

      expect(container.querySelector('.markdown-preview-container')).toBeInTheDocument()
    })

    it('keeps a text block whose own text is a JSON document as a JSON tree', () => {
      render(
        <McpContentBlocks
          toolName="mcp__server__tool"
          blocks={[{ type: 'text', text: JSON.stringify({ ids: [1, 2], distances: [0.1, 0.2] }) }]}
        />,
      )

      const jsonView = screen.getByTestId('json-view')
      expect(JSON.parse(jsonView.textContent)).toEqual({ ids: [1, 2], distances: [0.1, 0.2] })
    })

    it('renders a copy button on a text block, copying the text not the envelope', () => {
      const { container } = render(
        <McpContentBlocks
          toolName="mcp__server__tool"
          blocks={[{ type: 'text', text: 'copy me' }]}
        />,
      )

      expect(container.querySelector('.tool-copy-btn')).toBeInTheDocument()
    })
  })

  describe('order', () => {
    it('renders every block, in the order the result lists them', () => {
      render(
        <McpContentBlocks
          toolName="mcp__server__tool"
          blocks={[
            { type: 'text', text: 'first block' },
            { type: 'text', text: 'second block' },
          ]}
        />,
      )

      const texts = screen.getAllByText(/block$/).map(el => el.textContent)
      expect(texts).toEqual(['first block', 'second block'])
    })
  })

  describe('image block', () => {
    it("renders an image element with the block's own data and mime type", () => {
      const { container } = render(
        <McpContentBlocks
          toolName="mcp__server__tool"
          blocks={[{ type: 'image', data: 'AAAA', mimeType: 'image/png' }]}
        />,
      )

      const img = container.querySelector('img')
      expect(img).toBeInTheDocument()
      expect(img.src).toContain('data:image/png;base64,AAAA')
    })

    it('renders nothing for an image block with no data', () => {
      const { container } = render(
        <McpContentBlocks
          toolName="mcp__server__tool"
          blocks={[{ type: 'image', mimeType: 'image/png' }]}
        />,
      )

      expect(container.querySelector('img')).not.toBeInTheDocument()
    })
  })

  describe('resource link', () => {
    it("shows the link's name, description, and uri", () => {
      render(
        <McpContentBlocks
          toolName="mcp__server__tool"
          blocks={[
            {
              type: 'resource_link',
              name: 'report.pdf',
              description: 'Quarterly report',
              uri: 'file:///reports/report.pdf',
            },
          ]}
        />,
      )

      const link = screen.getByRole('link', { name: 'report.pdf' })
      expect(link).toHaveAttribute('href', 'file:///reports/report.pdf')
      expect(screen.getByText('Quarterly report')).toBeInTheDocument()
    })
  })

  describe('embedded resource', () => {
    it('treats a text resource exactly as a text block', () => {
      render(
        <McpContentBlocks
          toolName="mcp__server__tool"
          blocks={[
            {
              type: 'resource',
              resource: { uri: 'file:///notes.txt', mimeType: 'text/plain', text: 'note contents' },
            },
          ]}
        />,
      )

      expect(screen.getByText('note contents')).toBeInTheDocument()
    })

    it('names uri and media type for a binary resource, no viewer', () => {
      render(
        <McpContentBlocks
          toolName="mcp__server__tool"
          blocks={[
            {
              type: 'resource',
              resource: { uri: 'file:///photo.png', mimeType: 'image/png', blob: 'AAAA' },
            },
          ]}
        />,
      )

      expect(screen.getByText(/Resource/)).toHaveTextContent('image/png')
      expect(screen.getByText(/Resource/)).toHaveTextContent('file:///photo.png')
      expect(document.querySelector('img')).not.toBeInTheDocument()
    })
  })

  describe('audio block', () => {
    it('names the media type, no player', () => {
      render(
        <McpContentBlocks
          toolName="mcp__server__tool"
          blocks={[{ type: 'audio', data: 'AAAA', mimeType: 'audio/mpeg' }]}
        />,
      )

      expect(screen.getByText(/Audio/)).toHaveTextContent('audio/mpeg')
      expect(document.querySelector('audio')).not.toBeInTheDocument()
    })
  })

  describe('unknown block type', () => {
    it('falls back to a JSON view of that block rather than disappearing', () => {
      render(
        <McpContentBlocks
          toolName="mcp__server__tool"
          blocks={[{ type: 'future_block_type', payload: 'whatever' }]}
        />,
      )

      const jsonView = screen.getByTestId('json-view')
      expect(JSON.parse(jsonView.textContent)).toEqual({
        type: 'future_block_type',
        payload: 'whatever',
      })
    })
  })
})
