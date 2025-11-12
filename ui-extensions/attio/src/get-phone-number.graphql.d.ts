/**
 * ****************************************************
 * THIS FILE IS AUTO-GENERATED AT DEVELOPMENT TIME.
 *
 * DO NOT EDIT DIRECTLY OR COMMIT IT TO SOURCE CONTROL.
 * ****************************************************
 */
import { Query } from "attio/client";

type Exact<T extends { [key: string]: unknown }> = { [K in keyof T]: T[K] };

type Scalars = {
  ID: { input: string; output: string };
  String: { input: string; output: string };
  Boolean: { input: boolean; output: boolean };
  Int: { input: number; output: number };
  Float: { input: number; output: number };
};

declare module "./get-phone-number.graphql" {
  export type GetPhoneNumberQueryVariables = Exact<{
    recordId: Scalars["String"]["input"];
    object: Scalars["String"]["input"];
  }>;

  export type GetPhoneNumberQuery = {
    object:
      | {
          attributes: Array<{
            slug: string;
            title: string;
            type: AttributeType;
          }>;
        }
      | {
          attributes: Array<{
            slug: string;
            title: string;
            type: AttributeType;
          }>;
        }
      | {
          attributes: Array<{
            slug: string;
            title: string;
            type: AttributeType;
          }>;
        }
      | {
          attributes: Array<{
            slug: string;
            title: string;
            type: AttributeType;
          }>;
        }
      | {
          attributes: Array<{
            slug: string;
            title: string;
            type: AttributeType;
          }>;
        }
      | {
          attributes: Array<{
            slug: string;
            title: string;
            type: AttributeType;
          }>;
        }
      | null;
    record:
      | {
          id: string;
          attribute:
            | { __typename?: "RecordReferenceValue" }
            | { __typename?: "MultiRecordReferenceValue" }
            | { __typename?: "PersonalNameValue" }
            | { __typename?: "TextValue" }
            | { __typename?: "DateValue" }
            | { __typename?: "TimestampValue" }
            | { __typename?: "NumberValue" }
            | { __typename?: "MultiEmailAddressValue" }
            | { __typename?: "DomainValue" }
            | { __typename?: "MultiDomainValue" }
            | { __typename?: "LocationValue" }
            | { __typename?: "InteractionValue" }
            | { __typename?: "SelectValue" }
            | { __typename?: "MultiSelectValue" }
            | { __typename?: "StatusValue" }
            | { __typename?: "CheckboxValue" }
            | { __typename?: "RatingValue" }
            | { value: string | null }
            | { values: Array<string> }
            | { __typename?: "CurrencyValue" }
            | { __typename?: "ActorReferenceValue" }
            | { __typename?: "MultiActorReferenceValue" }
            | null;
        }
      | {
          id: string;
          attribute:
            | { __typename?: "RecordReferenceValue" }
            | { __typename?: "MultiRecordReferenceValue" }
            | { __typename?: "PersonalNameValue" }
            | { __typename?: "TextValue" }
            | { __typename?: "DateValue" }
            | { __typename?: "TimestampValue" }
            | { __typename?: "NumberValue" }
            | { __typename?: "MultiEmailAddressValue" }
            | { __typename?: "DomainValue" }
            | { __typename?: "MultiDomainValue" }
            | { __typename?: "LocationValue" }
            | { __typename?: "InteractionValue" }
            | { __typename?: "SelectValue" }
            | { __typename?: "MultiSelectValue" }
            | { __typename?: "StatusValue" }
            | { __typename?: "CheckboxValue" }
            | { __typename?: "RatingValue" }
            | { value: string | null }
            | { values: Array<string> }
            | { __typename?: "CurrencyValue" }
            | { __typename?: "ActorReferenceValue" }
            | { __typename?: "MultiActorReferenceValue" }
            | null;
        }
      | {
          id: string;
          attribute:
            | { __typename?: "RecordReferenceValue" }
            | { __typename?: "MultiRecordReferenceValue" }
            | { __typename?: "PersonalNameValue" }
            | { __typename?: "TextValue" }
            | { __typename?: "DateValue" }
            | { __typename?: "TimestampValue" }
            | { __typename?: "NumberValue" }
            | { __typename?: "MultiEmailAddressValue" }
            | { __typename?: "DomainValue" }
            | { __typename?: "MultiDomainValue" }
            | { __typename?: "LocationValue" }
            | { __typename?: "InteractionValue" }
            | { __typename?: "SelectValue" }
            | { __typename?: "MultiSelectValue" }
            | { __typename?: "StatusValue" }
            | { __typename?: "CheckboxValue" }
            | { __typename?: "RatingValue" }
            | { value: string | null }
            | { values: Array<string> }
            | { __typename?: "CurrencyValue" }
            | { __typename?: "ActorReferenceValue" }
            | { __typename?: "MultiActorReferenceValue" }
            | null;
        }
      | {
          id: string;
          attribute:
            | { __typename?: "RecordReferenceValue" }
            | { __typename?: "MultiRecordReferenceValue" }
            | { __typename?: "PersonalNameValue" }
            | { __typename?: "TextValue" }
            | { __typename?: "DateValue" }
            | { __typename?: "TimestampValue" }
            | { __typename?: "NumberValue" }
            | { __typename?: "MultiEmailAddressValue" }
            | { __typename?: "DomainValue" }
            | { __typename?: "MultiDomainValue" }
            | { __typename?: "LocationValue" }
            | { __typename?: "InteractionValue" }
            | { __typename?: "SelectValue" }
            | { __typename?: "MultiSelectValue" }
            | { __typename?: "StatusValue" }
            | { __typename?: "CheckboxValue" }
            | { __typename?: "RatingValue" }
            | { value: string | null }
            | { values: Array<string> }
            | { __typename?: "CurrencyValue" }
            | { __typename?: "ActorReferenceValue" }
            | { __typename?: "MultiActorReferenceValue" }
            | null;
        }
      | {
          id: string;
          attribute:
            | { __typename?: "RecordReferenceValue" }
            | { __typename?: "MultiRecordReferenceValue" }
            | { __typename?: "PersonalNameValue" }
            | { __typename?: "TextValue" }
            | { __typename?: "DateValue" }
            | { __typename?: "TimestampValue" }
            | { __typename?: "NumberValue" }
            | { __typename?: "MultiEmailAddressValue" }
            | { __typename?: "DomainValue" }
            | { __typename?: "MultiDomainValue" }
            | { __typename?: "LocationValue" }
            | { __typename?: "InteractionValue" }
            | { __typename?: "SelectValue" }
            | { __typename?: "MultiSelectValue" }
            | { __typename?: "StatusValue" }
            | { __typename?: "CheckboxValue" }
            | { __typename?: "RatingValue" }
            | { value: string | null }
            | { values: Array<string> }
            | { __typename?: "CurrencyValue" }
            | { __typename?: "ActorReferenceValue" }
            | { __typename?: "MultiActorReferenceValue" }
            | null;
        }
      | {
          id: string;
          attribute:
            | { __typename?: "RecordReferenceValue" }
            | { __typename?: "MultiRecordReferenceValue" }
            | { __typename?: "PersonalNameValue" }
            | { __typename?: "TextValue" }
            | { __typename?: "DateValue" }
            | { __typename?: "TimestampValue" }
            | { __typename?: "NumberValue" }
            | { __typename?: "MultiEmailAddressValue" }
            | { __typename?: "DomainValue" }
            | { __typename?: "MultiDomainValue" }
            | { __typename?: "LocationValue" }
            | { __typename?: "InteractionValue" }
            | { __typename?: "SelectValue" }
            | { __typename?: "MultiSelectValue" }
            | { __typename?: "StatusValue" }
            | { __typename?: "CheckboxValue" }
            | { __typename?: "RatingValue" }
            | { value: string | null }
            | { values: Array<string> }
            | { __typename?: "CurrencyValue" }
            | { __typename?: "ActorReferenceValue" }
            | { __typename?: "MultiActorReferenceValue" }
            | null;
        }
      | null;
  };

  const value: Query<GetPhoneNumberQueryVariables, GetPhoneNumberQuery>;
  export default value;
}
