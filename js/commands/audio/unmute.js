import { sound } from './sound.js?v=732eee3151';

export const unmute = {
  name: 'unmute',
  description: 'Unmute all sounds.',
  category: 'audio',
  args: [],
  run: async (args, shell) => {
    await sound.run(['on'], shell);
  }
};
