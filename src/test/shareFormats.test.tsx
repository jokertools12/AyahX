import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SocialShareButtons } from '@/components/SocialShareButtons';
vi.mock('sonner', () => ({ toast: {success:vi.fn(),info:vi.fn(),error:vi.fn()} }));
afterEach(()=>{cleanup();vi.restoreAllMocks();});
describe('sharing selected export format',()=>{
 it.each(['mp4','webm'] as const)('shares a correctly named and typed %s file',async format=>{
  const share=vi.fn(async()=>undefined);
  Object.defineProperty(navigator,'share',{configurable:true,value:share});
  Object.defineProperty(navigator,'canShare',{configurable:true,value:()=>true});
  render(<SocialShareButtons videoBlob={new Blob(['webm'],{type:'video/webm'})} mp4Blob={new Blob(['mp4'],{type:'video/mp4'})} title="test" text="test" filename="clip.mp4" format={format}/>);
  fireEvent.click(screen.getByRole('button',{name:'Instagram'}));
  await waitFor(()=>expect(share).toHaveBeenCalledOnce());
  const file=(share.mock.calls[0] as unknown as [{files:File[]}])[0].files[0];
  expect(file.name).toBe(`clip.${format}`);expect(file.type).toBe(`video/${format}`);
 });
});
