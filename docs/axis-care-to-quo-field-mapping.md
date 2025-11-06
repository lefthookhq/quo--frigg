# **AxisCare → Quo (OpenPhone)**

_Push relevant contact information to OpenPhone for clients, leads, responsible parties, caregivers, applicants, emergency contacts, and contacts._
This document is used to map contact information from AxisCare to Quo (OpenPhone), during a syncing process.

## **CLIENT**

| AxisCare Field                              | OpenPhone Field (Main Line) |
| :------------------------------------------ | :-------------------------- |
| Goes By (or First Name if no Goes By field) | First Name                  |
| Last Name                                   | Last Name                   |
| Phone (Home)                                | Phone Number                |
| Phone (Other)                               | Phone Number                |
| Phone (Mobile)                              | Phone Number                |
| Contact Type (Client)                       | Role                        |
| Client Class                                | Label                       |
| Permanent Priority Notes                    | Notes                       |

## **LEAD**

| AxisCare Field           | OpenPhone Field (Main Line) |
| :----------------------- | :-------------------------- |
| First Name               | First Name                  |
| Last Name                | Last Name                   |
| Phone                    | Phone Number                |
| Mobile Phone             | Phone Number                |
| Contact Type (Lead)      | Role                        |
| Permanent Priority Notes | Notes                       |

## **RESPONSIBLE PARTY \- CLIENT/LEAD**

| AxisCare Field                   | OpenPhone Field (Main Line) |
| :------------------------------- | :-------------------------- |
| Name                             | First & Last Name           |
| Phone Number                     | Phone Number                |
| Contact Type (Responsible Party) | Role                        |
| Client / Lead First & Last Name  | Text                        |
| Relationship                     | Text                        |
| Permanent Priority Notes         | Notes                       |

## **CAREGIVER**

| AxisCare Field                              | OpenPhone Field (Caregiver Line) |
| :------------------------------------------ | :------------------------------- |
| Goes By (or First Name if no Goes By field) | First Name                       |
| Last Name                                   | Last Name                        |
| Phone (Home)                                | Phone Number                     |
| Phone (Mobile)                              | Phone Number                     |
| Phone (Other)                               | Phone Number                     |
| Contact Type (Caregiver)                    | Role                             |
| Caregiver Class                             | Label                            |
| Permanent Priority Notes                    | Notes                            |

## **APPLICANT**

| AxisCare Field           | OpenPhone Field (Caregiver Line) |
| :----------------------- | :------------------------------- |
| First Name               | First Name                       |
| Last Name                | Last Name                        |
| Phone (Home)             | Phone Number                     |
| Phone (Mobile)           | Phone Number                     |
| Phone (Other)            | Phone Number                     |
| Contact Type (Applicant) | Role                             |
| Permanent Priority Notes | Notes                            |

## **EMERGENCY CONTACT \- CAREGIVER/APPLICANT**

| AxisCare Field                   | OpenPhone Field (Caregiver Line) |
| :------------------------------- | :------------------------------- |
| Name                             | First & Last Name                |
| Phone Number                     | Phone Number                     |
| Contact Type (Emergency Contact) | Role                             |
| Caregiver First & Last Name      | Text                             |
| Relationship                     | Text                             |
| Permanent Priority Notes         | Notes                            |

## **CONTACT**

| AxisCare Field                              | OpenPhone Field (Main Line) |
| :------------------------------------------ | :-------------------------- |
| Goes By (or First Name if no Goes By field) | First Name                  |
| Last Name                                   | Last Name                   |
| Phone (Office)                              | Phone Number                |
| Direct Line                                 | Phone Number                |
| Phone (Mobile)                              | Phone Number                |
| Contact Class                               | Role                        |
| Organization                                | Company                     |
| Permanent Priority Notes                    | Notes                       |

---

# **Quo (OpenPhone) → AxisCare**

_Push call summaries to AxisCare phone log and tag relevant parties._

| OpenPhone Field                            | AxisCare Field          |
| :----------------------------------------- | :---------------------- |
| First & Last Name                          | Call Log \- Caller Name |
| Phone Number                               | Caller Phone            |
| Call Summary Transcript                    | Notes                   |
| If AI Call Tag,                            | Subject                 |
| If phone number is in the AxisCare system, | tag the relevant person |
