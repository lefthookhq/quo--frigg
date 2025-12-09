// Mock GraphQL query for testing
export default `
query GetPhoneNumber($recordId: String!, $object: String!) {
  object(slug: $object) {
    attributes {
      slug
      title
      type
    }
  }
  record(id: $recordId, object: $object) {
    id
    attribute(slug: "phone_numbers") {
      ... on PhoneNumberValue {
        value
      }
      ... on MultiPhoneNumberValue {
        values
      }
    }
  }
}
`
