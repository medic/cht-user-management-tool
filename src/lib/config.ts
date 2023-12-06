import _ from "lodash";
import config from "../config.json";

export type ContactType = {
  name: string;
  friendly: string;
  parent_type: string;
  contact_type: string;
  contact_role: string;
  place_properties: ContactProperty[];
  contact_properties: ContactProperty[];
};

export type ContactProperty = {
  csv_name: string;
  doc_name: string;
  type: string;
  validator? : string | string[];
  required: boolean;
};

export type AuthenticationDomains = {
  friendly: string;
  domain: string;
};

export class Config {
  private constructor() {}

  public static contactTypes(): ContactType[] {
    return config.contact_types;
  }

  public static getContactType(name: string) : ContactType {
    const contactMatch = config.contact_types.find(c => c.name === name);
    if (!contactMatch) {
      throw new Error(`unrecognized contact type: "${name}"`);
    }
    return contactMatch;
  }

  public static domains() : AuthenticationDomains[] {
    return _.sortBy(config.domains, 'friendly');
  }
}
