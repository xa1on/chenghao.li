import { sound } from './sound.js?v=1abba25708';

export const unmute = {
  name: 'unmute',
  description: 'Unmute all sounds.',
  category: 'audio',
  args: [],
  run: async (args, shell) => {
    await sound.run(['on'], shell);
  }
};
