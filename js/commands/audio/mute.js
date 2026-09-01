import { sound } from './sound.js?v=1abba25708';

export const mute = {
  name: 'mute',
  description: 'Mute all sounds.',
  category: 'audio',
  args: [],
  run: async (args, shell) => {
    await sound.run(['off'], shell);
  }
};
