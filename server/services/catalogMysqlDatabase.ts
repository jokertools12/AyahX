import type { Pool, PoolConnection } from 'mysql2/promise';
import type { CatalogDatabase,CatalogTx,CatalogRow } from './catalogContracts';
/** Shared audit-chain advisory lock spans COMMIT. No lock is released early. */
export function catalogDatabaseFromPool(pool:Pool):CatalogDatabase {
  const executor=(connection:Pick<PoolConnection,'query'>):CatalogTx=>({
    read:async(sql,params=[])=>{const [rows]=await connection.query(sql,params);if(!Array.isArray(rows))throw new Error('CATALOG_ROWS_EXPECTED');return rows as CatalogRow[];},
    execute:async(sql,params=[])=>{await connection.query(sql,params);},
  });
  return {
    ...executor(pool),
    transaction:async<T>(work:(tx:CatalogTx)=>Promise<T>):Promise<T>=>{
      const connection=await pool.getConnection();let locked=false;
      try {
        const [rows]=await connection.query("SELECT GET_LOCK('ayahx_audit_chain',10) acquired");
        if(!Array.isArray(rows)||Number((rows as CatalogRow[])[0]?.acquired)!==1)throw new Error('CATALOG_AUDIT_LOCK_UNAVAILABLE');locked=true;
        await connection.beginTransaction();
        try{const value=await work(executor(connection));await connection.commit();return value;}
        catch(error){await connection.rollback();throw error;}
      }finally{try{if(locked)await connection.query("SELECT RELEASE_LOCK('ayahx_audit_chain')");}finally{connection.release();}}
    },
  };
}
