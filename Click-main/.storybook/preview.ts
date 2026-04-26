import type { Preview } from '@storybook/react'
import '../src/components/base/tailwind.css'

const preview: Preview = {
  parameters: {
    backgrounds: {
      default: 'cream',
      values: [
        { name: 'cream',  value: '#FAF7F0' },
        { name: 'white',  value: '#FFFFFF' },
        { name: 'gray',   value: '#F0F3F1' },
      ],
    },
    a11y: { config: {} },
    controls: { matchers: { color: /(background|color)$/i, date: /Date$/i } },
  },
}

export default preview
