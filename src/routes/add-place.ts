import { FastifyInstance } from 'fastify';

import { Config } from '../config';
import { ChtApi } from '../lib/cht-api';
import PlaceFactory from '../services/place-factory';
import SessionCache from '../services/session-cache';
import RemotePlaceResolver from '../lib/remote-place-resolver';
import { UploadManager } from '../services/upload-manager';
import RemotePlaceCache from '../lib/remote-place-cache';

export default async function addPlace(fastify: FastifyInstance) {
  fastify.get('/add-place', async (req, resp) => {
    const queryParams: any = req.query;

    const contactTypes = Config.contactTypes();
    const contactType = queryParams.type
      ? Config.getContactType(queryParams.type)
      : contactTypes[contactTypes.length - 1];
    const op = queryParams.op || 'new';
    const tmplData = {
      view: 'add',
      logo: Config.getLogoBase64(),
      session: req.chtSession,
      op,
      hierarchy: Config.getHierarchyWithReplacement(contactType, 'desc'),
      contactType,
      contactTypes,
    };

    return resp.view('src/liquid/app/view.html', tmplData);
  });

  // you want to create a place? replace a contact? you'll have to go through me first
  fastify.post('/place', async (req, resp) => {
    const { op, type: placeType } = req.query as any;

    const contactType = Config.getContactType(placeType);
    const sessionCache: SessionCache = req.sessionCache;
    const chtApi = new ChtApi(req.chtSession);
    if (op === 'new' || op === 'replace') {
      await PlaceFactory.createOne(req.body, contactType, sessionCache, chtApi);
      resp.header('HX-Redirect', `/`);
      return;
    }

    if (op === 'bulk') {
      // read the date we uploaded
      const fileData = await req.file();
      if (!fileData) {
        throw Error('no file data');
      }
      try {
        const csvBuf = await fileData.toBuffer();
        await PlaceFactory.createBulk(csvBuf, contactType, sessionCache, chtApi);
      } catch (error) {
        return fastify.view('src/liquid/place/bulk_create_form.html', {
          contactType,
          errors: {
            message: error,
          },
        });
      }

      // back to places list
      resp.header('HX-Redirect', `/`);
      return;
    }

    throw new Error('unknown op');
  });

  fastify.get('/place/edit/:id', async (req, resp) => {
    const params: any = req.params;
    const { id } = params;

    const sessionCache: SessionCache = req.sessionCache;
    const place = sessionCache.getPlace(id);
    if (!place || place.isCreated) {
      throw new Error('unknown place or place is already created');
    }

    const data = place.asFormData('hierarchy_');
    const tmplData = {
      view: 'edit',
      op: 'edit',
      logo: Config.getLogoBase64(),
      hierarchy: Config.getHierarchyWithReplacement(place.type, 'desc'),
      place,
      session: req.chtSession,
      contactType: place.type,
      contactTypes: Config.contactTypes(),
      backend: `/place/edit/${id}`,
      data,
    };

    resp.header('HX-Push-Url', `/place/edit/${id}`);
    return resp.view('src/liquid/app/view.html', tmplData);
  });

  fastify.post('/place/edit/:id', async (req, resp) => {
    const { id } = req.params as any;
    const data: any = req.body;
    const sessionCache: SessionCache = req.sessionCache;
    const chtApi = new ChtApi(req.chtSession);

    await PlaceFactory.editOne(id, data, sessionCache, chtApi);

    // back to places list
    resp.header('HX-Redirect', `/`);
  });

  fastify.post('/place/refresh/:id', async (req) => {
    const { id } = req.params as any;
    const sessionCache: SessionCache = req.sessionCache;
    const place = sessionCache.getPlace(id);
    if (!place) {
      throw Error(`unable to find place ${id}`);
    }

    const chtApi = new ChtApi(req.chtSession);
    RemotePlaceCache.clear(chtApi, place.type.name);
    await RemotePlaceResolver.resolveOne(place, sessionCache, chtApi, { fuzz: true });
    place.validate();

    fastify.uploadManager.refresh(req.sessionCache);
  });

  fastify.post('/place/upload/:id', async (req) => {
    const { id } = req.params as any;
    const sessionCache: SessionCache = req.sessionCache;
    const place = sessionCache.getPlace(id);
    if (!place) {
      throw Error(`unable to find place ${id}`);
    }

    const chtApi = new ChtApi(req.chtSession);
    const uploadManager: UploadManager = fastify.uploadManager;
    await uploadManager.doUpload([place], chtApi);
    fastify.uploadManager.refresh(req.sessionCache);
  });

  fastify.post('/place/remove/:id', async (req) => {
    const { id } = req.params as any;
    const sessionCache: SessionCache = req.sessionCache;
    sessionCache.removePlace(id);
    fastify.uploadManager.refresh(req.sessionCache);
  });
}
