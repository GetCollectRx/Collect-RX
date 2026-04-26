import type { Preview } from '@storybook/react'
import '../src/App.css'

const preview: Preview = {
  parameters: {
    controls: { matchers: { color: /(background|color)$/i, date: /Date$/i } },
    backgrounds: {
      default: 'light',
      values: [
        { name: 'light', value: '#f9fafb' },
        { name: 'dark',  value: '#030712' },
      ],
    },
  },
  globalTypes: {
    theme: {
      description: 'Dark mode',
      defaultValue: 'light',
      toolbar: {
        title: 'Theme',
        icon:  'circlehollow',
        items: ['light', 'dark'],
        dynamicTitle: true,
      },
    },
  },
  decorators: [
    (Story, context) => {
      const isDark = context.globals.theme === 'dark'
      document.documentElement.classList.toggle('dark', isDark)
      return Story()
    },
  ],
}

export default preview
