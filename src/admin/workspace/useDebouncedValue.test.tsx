import {afterEach,describe,it,expect,vi} from 'vitest';
import {act,cleanup,renderHook} from '@testing-library/react';
import {useDebouncedValue} from './useDebouncedValue';
afterEach(()=>{cleanup();vi.useRealTimers();});
describe('source selection debounce',()=>{
 it('settles only the last of a rapid native select sequence',()=>{vi.useFakeTimers();const hook=renderHook(({value})=>useDebouncedValue(value),{initialProps:{value:1}});for(let value=2;value<=103;value++)hook.rerender({value});expect(hook.result.current).toBe(1);act(()=>vi.advanceTimersByTime(249));expect(hook.result.current).toBe(1);act(()=>vi.advanceTimersByTime(1));expect(hook.result.current).toBe(103);});
 it('cancels a previously selected source when another is chosen',()=>{vi.useFakeTimers();const hook=renderHook(({value})=>useDebouncedValue(value),{initialProps:{value:'a'}});hook.rerender({value:'b'});act(()=>vi.advanceTimersByTime(200));hook.rerender({value:'c'});act(()=>vi.advanceTimersByTime(50));expect(hook.result.current).toBe('a');act(()=>vi.advanceTimersByTime(200));expect(hook.result.current).toBe('c');});
});
