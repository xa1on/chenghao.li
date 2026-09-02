import { sound } from './sound.js?v=732eee3151';

export const mute = {
  name: 'mute',
  description: 'Mute all sounds.',
  category: 'audio',
  args: [],
  run: async (args, shell) => {
    await sound.run(['off'], shell);
  }
};
