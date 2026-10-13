import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {AdminContext} from '../../adminState';
import {uploadLicensedAudio} from '../../workspace/uploadAudio';
import {readUploadCheckpoint} from '../../workspace/uploadCheckpoints';
import LicensedAudioUpload from './LicensedAudioUpload';
vi.mock('../../workspace/uploadAudio',()=>({uploadLicensedAudio:vi.fn()}));
const transport=vi.mocked(uploadLicensedAudio);
const user={id:'11111111-1111-4111-8111-111111111111',email:'unit@example.test',displayName:null,roles:['admin'],permissions:['storage.manage'],sessionId:'unit-session',environment:'local',totp:{enabled:false,required:false,encryptionConfigured:false}};
beforeEach(()=>{transport.mockReset();localStorage.clear();});
afterEach(cleanup);
describe('licensed audio recovery feedback',()=>{
 it('retains a failed checkpoint and removes the old failure only after the same file succeeds',async()=>{
  const checkpoint={storageObjectId:'33333333-3333-4333-8333-333333333333',sha256:'a'.repeat(64),sizeBytes:16,fileName:'103.mp3',partSizeBytes:16,partCount:1};
  transport.mockImplementationOnce(async input=>{input.onCheckpoint(checkpoint);throw new Error('AUDIO_UPLOAD_NETWORK_FAILED');});
  transport.mockResolvedValueOnce({storageObjectId:'33333333-3333-4333-8333-333333333333',verificationTaskId:null});
  render(<AdminContext.Provider value={{user,lang:'en',setLang:()=>{},refreshUser:()=>{}}}><LicensedAudioUpload recitationId="22222222-2222-4222-8222-222222222222" rightsRef="unit-owned-rights" enabled/></AdminContext.Provider>);
  fireEvent.change(screen.getByLabelText('Choose licensed audio files'),{target:{files:[new File([new Uint8Array(16)],'103.mp3',{type:'audio/mpeg'})]}});
  fireEvent.click(screen.getByRole('button',{name:'Start or resume upload'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('Upload did not complete');
  expect(readUploadCheckpoint(localStorage,user.id,'22222222-2222-4222-8222-222222222222',103)).toEqual(checkpoint);
  fireEvent.click(screen.getByRole('button',{name:'Start or resume upload'}));
  await waitFor(()=>expect(transport).toHaveBeenCalledTimes(2));
  await waitFor(()=>expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  expect(transport.mock.calls[1][0].checkpoint).toEqual(checkpoint);
  expect(readUploadCheckpoint(localStorage,user.id,'22222222-2222-4222-8222-222222222222',103)).toBeUndefined();
 });
});
