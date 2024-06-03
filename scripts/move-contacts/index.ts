import { queueManager } from '../../src/shared/queues';
import { Config } from '../../src/config';
import { ChtApi } from '../../src/lib/cht-api';
import ChtSession from '../../src/lib/cht-session';
import MoveLib from '../../src/lib/move';
import SessionCache from '../../src/services/session-cache';

import allPlacesToMove from './nairobi-judy.json';

import { config } from 'dotenv';
config();

const { username, password } = process.env;

if (!username || !password) {
  throw 'invalid env';
}

const authInfo = Config.getAuthenticationInfo('nairobi-echis.health.go.ke');
const contactType = Config.getContactType('d_community_health_volunteer_area');
const batchToMove = allPlacesToMove.slice(45, 100000);

(async () => {
  const session = await ChtSession.create(authInfo, username, password);
  const chtApi = new ChtApi(session);
  const sessionCache = SessionCache.getForSession(session);
  
  for (const toMove of batchToMove) {
    const [from_SUBCOUNTY, from_CHU, from_replacement_alternate, to_SUBCOUNTY, to_CHU, from_replacement] = toMove as any[];
    const formData = {
      from_SUBCOUNTY,
      from_CHU, 
      from_replacement: from_replacement || from_replacement_alternate,
      to_SUBCOUNTY,
      to_CHU,
    };
    
    
    try {
      const result = await MoveLib.move(formData, contactType, sessionCache, chtApi, queueManager);
      console.log('scheduled', formData.from_replacement);
    } catch (error: any) {
      console.log(`error: `, error?.message || '');
    }
  }
})();
