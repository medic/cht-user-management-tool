import _ from 'lodash';
import { AxiosInstance } from 'axios';
import * as semver from 'semver';

import ChtSession from './cht-session';
import { Config, ContactType } from '../config';
import { UserPayload } from '../services/user-payload';

export type PlacePayload = {
  name: string;
  type: string;
  contact_type: string;
  contact: {
    name: string;
    type: string;
    contact_type: string;
    [key: string]: any;
  };
  parent?: string;
  [key: string]: any;
};

export type CreatedPlaceResult = {
  placeId: string;
  contactId?: string;
};

export class ChtApi {
  protected axiosInstance: AxiosInstance;
  private session: ChtSession;
  private version: string;

  protected constructor(session: ChtSession) {
    this.session = session;
    this.axiosInstance = session.axiosInstance;
    this.version = 'base';
  }

  public static create(chtSession: ChtSession): ChtApi {
    let result;
    const coercedVersion = semver.valid(semver.coerce(chtSession.chtCoreVersion));
    if (!coercedVersion) {
      throw Error(`invalid cht core version "${chtSession.chtCoreVersion}"`);
    }

    if (semver.gte(coercedVersion, '4.11.0') || chtSession.chtCoreVersion === '4.11.0-local-development') {
      result = new ChtApi_4_11(chtSession);
      result.version = '4.11';
    } else {
      result = new ChtApi(chtSession);
    }
  
    return result;
  }

  async createPlace(payload: PlacePayload): Promise<CreatedPlaceResult> {
    const url = `api/v1/places`;
    console.log('axios.post', url);
    const resp = await this.axiosInstance.post(url, payload);
    return {
      placeId: resp.data.id,
      contactId: resp.data.contact?.id,
    };
  }

  // because there is no PUT for /api/v1/places
  async createContact(payload: PlacePayload): Promise<string> {
    const payloadWithPlace = {
      ...payload.contact,
      place: payload._id,
    };

    const url = `api/v1/people`;
    console.log('axios.post', url);
    const resp = await this.axiosInstance.post(url, payloadWithPlace);
    return resp.data.id;
  }

  async updatePlace(payload: PlacePayload, contactId: string): Promise<any> {
    const doc: any = await this.getDoc(payload._id);

    const payloadClone:any = _.cloneDeep(payload);
    delete payloadClone.contact;
    delete payloadClone.parent;

    const previousPrimaryContact = doc.contact?._id;
    Object.assign(doc, payloadClone, { contact: { _id: contactId }});
    doc.user_attribution ||= {};
    doc.user_attribution.previousPrimaryContacts ||= [];
    if (previousPrimaryContact) {
      doc.user_attribution.previousPrimaryContacts.push(previousPrimaryContact);
    }

    const putUrl = `medic/${payload._id}`;
    console.log('axios.put', putUrl);
    const resp = await this.axiosInstance.put(putUrl, doc);
    if (!resp.data.ok) {
      throw Error('response from chtApi.updatePlace was not OK');
    }

    return doc;
  }

  async deleteDoc(docId: string): Promise<void> {
    const doc: any = await this.getDoc(docId);

    const deleteContactUrl = `medic/${doc._id}?rev=${doc._rev}`;
    console.log('axios.delete', deleteContactUrl);
    const resp = await this.axiosInstance.delete(deleteContactUrl);
    if (!resp.data.ok) {
      throw Error('response from chtApi.deleteDoc was not OK');
    }
  }

  async disableUsersWithPlace(placeId: string): Promise<string[]> {
    const usersToDisable: string[] = await this.getUsersAtPlace(placeId);
    for (const userDocId of usersToDisable) {
      await this.disableUser(userDocId);
    }
    return usersToDisable;
  }

  async deactivateUsersWithPlace(placeId: string): Promise<string[]> {
    const usersToDeactivate: string[] = await this.getUsersAtPlace(placeId);
    for (const userDocId of usersToDeactivate) {
      await this.deactivateUser(userDocId);
    }
    return usersToDeactivate;
  }

  async createUser(user: UserPayload): Promise<void> {
    const url = `api/v1/users`;
    console.log('axios.post', url);
    const axiosRequestionConfig = {
      'axios-retry': { retries: 0 }, // upload-manager handles retries for this
    };
    await this.axiosInstance.post(url, user, axiosRequestionConfig);
  }

  async getParentAndSibling(parentId: string, contactType: ContactType): Promise<{ parent: any; sibling: any }> {
    const url = `medic/_design/medic/_view/contacts_by_depth`;
    console.log('axios.get', url);
    const resp = await this.axiosInstance.get(url, {
      params: {
        keys: JSON.stringify([
          [parentId, 0],
          [parentId, 1]
        ]),
        include_docs: true,
      },
    });
    const docs = resp.data?.rows?.map((row: any) => row.doc) || [];
    const parentType = Config.getParentProperty(contactType).contact_type;
    const parent = docs.find((d: any) => d.contact_type === parentType);
    const sibling = docs.find((d: any) => d.contact_type === contactType.name);
    return { parent, sibling };
  }

  getPlacesWithType = async (placeType: string)
    : Promise<any[]> => {
    const url = `medic/_design/medic-client/_view/contacts_by_type`;
    const params = {
      key: JSON.stringify([placeType]),
      include_docs: true,
    };
    console.log('axios.get', url, params);
    const resp = await this.axiosInstance.get(url, { params });
    return resp.data.rows.map((row: any) => row.doc);
  };

  public get chtSession(): ChtSession {
    return this.session.clone();
  }

  public get coreVersion(): string {
    return this.version;
  }

  protected async getUsersAtPlace(placeId: string): Promise<string[]> {
    const url = `api/v2/users?facility_id=${placeId}`;
    console.log('axios.get', url);
    const resp = await this.axiosInstance.get(url);
    return resp.data?.map((d: any) => d.id);
  }

  private async getDoc(id: string): Promise<any> {
    const url = `medic/${id}`;
    console.log('axios.get', url);
    const resp = await this.axiosInstance.get(url);
    return resp.data;
  }

  private async deactivateUser(docId: string): Promise<void> {
    const username = docId.substring('org.couchdb.user:'.length);
    const url = `api/v1/users/${username}`;
    console.log('axios.post', url);
    const deactivationPayload = { roles: ['deactivated' ]};
    return this.axiosInstance.post(url, deactivationPayload);
  }

  private async disableUser(docId: string): Promise<void> {
    const username = docId.substring('org.couchdb.user:'.length);
    const url = `api/v1/users/${username}`;
    console.log('axios.delete', url);
    return this.axiosInstance.delete(url);
  }
}
