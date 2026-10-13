import {useEffect,useState} from 'react';
/** Wait for native select keyboard navigation to settle before querying a source. */
export function useDebouncedValue<T>(value:T,delay=250):T{const [settled,setSettled]=useState(value);useEffect(()=>{const timer=window.setTimeout(()=>setSettled(value),delay);return()=>window.clearTimeout(timer);},[value,delay]);return settled;}
