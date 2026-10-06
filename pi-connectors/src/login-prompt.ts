import type { AuthPrompt } from '@earendil-works/pi-ai';

export async function answerLoginPrompt(prompt: AuthPrompt, ask: (message: string) => Promise<string>): Promise<string> {
  prompt.signal?.throwIfAborted();
  if (prompt.type === 'secret') throw new Error('Secret entry is not supported by this OAuth CLI');
  if (prompt.type !== 'select') return ask(`${prompt.message}\n> `);
  if (!prompt.options.length) throw new Error('OAuth provider offered no login methods');
  const menu = prompt.options.map((option, index) => `${index + 1}. ${option.label}${option.description ? ` — ${option.description}` : ''}`).join('\n');
  let retry = '';
  while (true) {
    prompt.signal?.throwIfAborted();
    const value = (await ask(`${retry}${prompt.message}\n${menu}\nChoose a number or method ID [1]: `)).trim();
    const option = value === '' ? prompt.options[0] : prompt.options.find(option => option.id === value) ?? (/^[1-9]\d*$/.test(value) ? prompt.options[Number(value) - 1] : undefined);
    if (option) return option.id;
    retry = 'Invalid choice. Select one of the listed methods.\n';
  }
}
