import {afterEach,describe,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {SearchCombobox} from './AdminInteractions';
const options=[{value:'reader-one',label:'First reader'},{value:'reader-two',label:'Second reader'}];
afterEach(cleanup);
describe('admin search combobox dialog relationships',()=>{
 it('advertises the exact mounted dialog while open and clears aria-controls immediately when closed',async()=>{
  const change=vi.fn();render(<SearchCombobox label="Choose reader" value="" options={options} onChange={change}/>);
  const trigger=screen.getByRole('combobox',{name:'Choose reader'});expect(trigger).toHaveAttribute('aria-haspopup','dialog');expect(trigger).toHaveAttribute('aria-expanded','false');expect(trigger).not.toHaveAttribute('aria-controls');
  fireEvent.click(trigger);const dialog=await screen.findByRole('dialog',{name:'Choose reader'}),id=dialog.id;
  expect(trigger).toHaveAttribute('aria-expanded','true');expect(trigger).toHaveAttribute('aria-controls',id);expect(document.getElementById(id)).toBe(dialog);expect(document.querySelectorAll(`[id="${id}"]`)).toHaveLength(1);
  fireEvent.click(screen.getByRole('button',{name:'Second reader'}));expect(change).toHaveBeenCalledWith('reader-two');expect(trigger).toHaveAttribute('aria-expanded','false');expect(trigger).not.toHaveAttribute('aria-controls');await waitFor(()=>expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  fireEvent.click(trigger);expect(await screen.findByRole('dialog',{name:'Choose reader'})).toHaveAttribute('id',id);expect(trigger).toHaveAttribute('aria-controls',id);
 });
 it('uses unique input and popup IDs even when two controls share a translated field label',async()=>{
  render(<><SearchCombobox label="Choose reader" value="" options={options} onChange={()=>{}}/><SearchCombobox label="Choose reader" value="" options={options} onChange={()=>{}}/></>);
  const [first,second]=screen.getAllByRole('combobox');fireEvent.click(first);const firstPopup=await screen.findByRole('dialog'),firstId=firstPopup.id,firstInput=screen.getByRole('textbox').id;
  fireEvent.click(screen.getByRole('button',{name:'First reader'}));await waitFor(()=>expect(screen.queryByRole('dialog')).not.toBeInTheDocument());fireEvent.click(second);const secondPopup=await screen.findByRole('dialog'),secondInput=(await screen.findByRole('textbox')).id;
  expect(secondPopup.id).not.toBe(firstId);expect(secondInput).not.toBe(firstInput);expect(first).not.toHaveAttribute('aria-controls');expect(second).toHaveAttribute('aria-controls',secondPopup.id);expect(screen.getByLabelText('Choose reader',{selector:'input'})).toHaveAttribute('id',secondInput);
 });
});
