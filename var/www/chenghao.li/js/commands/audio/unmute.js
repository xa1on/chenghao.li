import { sound } from './sound.js?v=9ee3db3b17';

export const unmute = {
  name: 'unmute',
  description: 'Unmute all sounds.',
  category: 'audio',
  args: [],
  run: async (args, shell) => {
    await sound.run(['on'], shell);
  }
};
