import EventEmitter from 'events';
import { ChtApi, PlacePayload } from '../lib/cht-api';

import Place, { PlaceUploadState } from './place';
import { UserPayload } from './user-payload';
import { UploadReplacementPlace } from './upload.replacement';
import { UploadNewPlace } from './upload.new';
import { Config } from '../config';
import RemotePlaceCache from '../lib/remote-place-cache';

const UPLOAD_BATCH_SIZE = 1;

export interface Uploader {
   handleContact (payload: PlacePayload): Promise<string | undefined>;
   handlePlacePayload (place: Place, payload: PlacePayload) : Promise<string>;
   linkContactAndPlace (place: Place, placeId: string): Promise<void>;
}

export class UploadManager extends EventEmitter {
  doUpload = async (places: Place[], chtApi: ChtApi) => {
    const placesNeedingUpload = places.filter(p => !p.isCreated && !p.hasValidationErrors);
    this.eventedPlaceStateChange(placesNeedingUpload, PlaceUploadState.SCHEDULED);

    const independants = placesNeedingUpload.filter(p => !p.isDependant);
    const dependants = placesNeedingUpload.filter(p => p.isDependant);
    await this.uploadPlacesInBatches(independants, chtApi);
    await this.uploadPlacesInBatches(dependants, chtApi);
  };

  private async uploadPlacesInBatches(places: Place[], chtApi: ChtApi) {
    for (let batchStartIndex = 0; batchStartIndex < places.length; batchStartIndex += UPLOAD_BATCH_SIZE) {
      const batchEndIndex = Math.min(batchStartIndex + UPLOAD_BATCH_SIZE, places.length);
      const batch = places.slice(batchStartIndex, batchEndIndex);
      await Promise.all(batch.map(place => this.uploadSinglePlace(place, chtApi)));
    }
  }

  private async uploadSinglePlace(place: Place, chtApi: ChtApi) {
    this.eventedPlaceStateChange(place, PlaceUploadState.IN_PROGRESS);

    try {
      const uploader: Uploader = place.hierarchyProperties.replacement ? new UploadReplacementPlace(chtApi) : new UploadNewPlace(chtApi);
      const payload = place.asChtPayload(chtApi.chtSession.username);
      await Config.mutate(payload, chtApi, !!place.properties.replacement);

      if (!place.creationDetails.contactId) {
        const contactId = await uploader.handleContact(payload);
        place.creationDetails.contactId = contactId;
      }

      if (!place.creationDetails.placeId) {
        const placeId = await uploader.handlePlacePayload(place, payload);
        place.creationDetails.placeId = placeId;
      }

      await uploader.linkContactAndPlace(place, place.creationDetails?.placeId);

      if (!place.creationDetails.contactId) {
        throw Error('creationDetails.contactId not set');
      }

      if (!place.creationDetails.username) {
        const userPayload = new UserPayload(place, place.creationDetails.placeId, place.creationDetails.contactId);
        const { username, password } = await tryCreateUser(userPayload, chtApi);
        place.creationDetails.username = username;
        place.creationDetails.password = password;
      }

      await RemotePlaceCache.add(place, chtApi);
      delete place.uploadError;

      console.log(`successfully created ${JSON.stringify(place.creationDetails)}`);
      this.eventedPlaceStateChange(place, PlaceUploadState.SUCCESS);
    } catch (err: any) {
      const errorDetails = err.response?.data.error || err.toString();
      console.log('error when creating user', errorDetails);
      place.uploadError = errorDetails;
      this.eventedPlaceStateChange(place, PlaceUploadState.FAILURE);
    }
  }

  public triggerRefresh(place_id: string | undefined) {
    if (place_id) {
      this.emit('refresh_table_row', place_id);
    } else {
      this.emit('refresh_table');
    }
  }

  private eventedPlaceStateChange = (subject: Place | Place[], state: PlaceUploadState) => {
    if (!Array.isArray(subject)) {
      subject = [subject];
    }
    
    if (subject.length > 1) {
      this.triggerRefresh(undefined);
      return;
    }

    subject.forEach(place => {
      place.state = state;
      this.triggerRefresh(place.id);
    });
  };
}

async function tryCreateUser (userPayload: UserPayload, chtApi: ChtApi): Promise<{ username: string; password: string }> {
  for (let retryCount = 0; retryCount < 5; ++retryCount) {
    try {
      await chtApi.createUser(userPayload);
      return userPayload;
    } catch (err: any) {      
      if (err?.response?.status !== 400) {
        throw err;
      }
      
      const msg = err.response?.data?.error?.message || err.response?.data;
      console.error('createUser retry because', msg);
      if (msg?.includes('already taken')) {
        userPayload.makeUsernameMoreComplex();
        continue;
      }

      if (msg?.includes('password')) { // password too easy to guess
        userPayload.regeneratePassword();
        continue;
      }

      throw err;
    }
  }

  throw new Error('could not create user ' + userPayload.contact);
}
