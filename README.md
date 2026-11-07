# 🏔️ Familienzeit
### Your family. Your holiday. Your time together.

A personalised holiday-planning experience that helps families discover, organise and enjoy activities during their stay in **Serfaus-Fiss-Ladis**.

Instead of navigating multiple tourism platforms, Familienzeit puts the family at the centre of the holiday experience — combining personal preferences, activity discovery and intelligent planning in one place.

Built during the **Tourism Technology Festival 2026** in Salzburg, Austria.

Our project addresses Challenge 06: **One Family Holiday, Four Booking Systems**.

---

## 💡 The Idea

Every family holiday is different.

Imagine arriving in Serfaus-Fiss-Ladis with two children, aged 4 and 9.

It's Tuesday, the weather forecast predicts rain, and you want to find something everyone can enjoy.

Where do you start?

Today, families have to navigate multiple platforms, compare age restrictions, check availability, consider weather conditions and switch between different booking processes.

**We want to change that.**

Familienzeit starts with the family, not with a catalogue of activities.

Our idea is to create a personalised holiday companion that understands what families enjoy and helps them make the most of their time together.

Families can define:
- When they are staying.
- How old their children are.
- What they enjoy doing.
- What kind of experiences they are looking for.
- Their interests and holiday preferences.

Based on this information, Familienzeit helps turn individual preferences into suitable activities and practical holiday plans.

**Less searching. Less planning. More gemeinsam erleben.**

## 🎨 The Prototype – Reise-Canvas

Our current prototype explores a more personal and visual approach to holiday planning.

The Reise-Canvas is the starting point of the Familienzeit experience.

Instead of immediately presenting families with hundreds of activities, it allows them to create their own personalised holiday canvas — a visual representation of their family, destination and holiday preferences.

The prototype focuses on:
- Creating a personal family holiday experience.
- Defining the family and travel context.
- Selecting the destination.
- Capturing individual interests and preferences.
- Generating a personalised visual holiday postcard.
- Providing an intuitive and engaging interface.

### 🚀 Try the Prototype

**[Open Familienzeit – Reise-Canvas](https://familienzeit-canvas-prototyp.dervondenbergen.chatgpt.site/)**

The prototype demonstrates the initial user experience and design direction. The complete activity discovery, itinerary planning and booking integrations represent the broader product vision.

## 🎯 The Challenge

**Challenge 06 – One Family Holiday, Four Booking Systems**

Partner: Dialogschmiede GmbH, on behalf of Serfaus-Fiss-Ladis.

Serfaus-Fiss-Ladis offers a wide range of family activities, from kids' clubs and guided hikes to bike parks and cable car experiences.

However, the information and booking processes are distributed across different systems:

| Platform | Content |
|---|---|
| Feratel | Events without registration |
| Feratel Experience Shop | Registration-based activities |
| Incert | Cable car experiences and online tickets |
| Contwise | Service providers and A–Z entries |

Families currently need to understand and navigate these systems individually.

Our goal is to make the experience feel like one connected destination.

## 🚀 Our Solution

We envision a unified family activity companion with three core capabilities.

### 1. Create – Your family's holiday canvas

Start with the people who matter most.

Families create their personal holiday profile by providing information about their travel dates, children's ages, interests and preferences.

This becomes the foundation for a personalised experience.

### 2. Discover – Find the right activities

Bring activities from different sources into one searchable experience.

Recommendations consider:
- Children's age groups.
- Family interests and preferences.
- Travel dates and available time.
- Activity duration.
- Weather conditions.
- Opening hours and operational status.

### 3. Plan & Book – Make the most of every day

Turn individual activities into realistic daily plans.

The planner considers:
- Available time and activity duration.
- Geographic distance between activities.
- Weather and changing conditions.
- Age suitability.
- Opening times and activity schedules.

Families can then continue to the relevant registration or booking process.

We distinguish between:
- Free activities without registration.
- Activities requiring registration.
- Paid experiences with online booking.

The goal is to reduce unnecessary steps without replacing the existing booking infrastructure.

## 👨‍👩‍👧‍👦 Our Target Audience

Familienzeit is designed specifically for families visiting Serfaus-Fiss-Ladis, especially parents who want to organise enjoyable activities for children of different ages.

Our example family:

- Two parents.
- Two children, aged 4 and 9.
- A week-long holiday.
- Different interests and activity preferences.
- A mixture of sunny and rainy days.

The experience should help the whole family find activities everyone can enjoy.

## 🧠 Intelligence & Personalisation

The application combines structured tourism data with intelligent recommendations.

Rather than relying on an AI model to invent activities or availability, we aim to use actual destination data as the foundation for recommendations.

AI can help with:
- Understanding natural-language requests.
- Translating family preferences into search criteria.
- Explaining why activities match a family.
- Supporting itinerary creation.
- Suggesting alternatives when weather or availability changes.

Activity details, age restrictions, opening hours and booking information should remain grounded in their respective data sources.

## 🗂️ Data Sources & Integrations

The solution is designed around the data and infrastructure made available for Challenge 06.

| Source | Purpose |
|---|---|
| Feratel | Events and activities without registration |
| Feratel Experience Shop | Activities requiring registration |
| Incert | Cable car experiences and ticket booking |
| Feratel / Contwise | Service providers and destination information |
| Austrian Tourism Data | Events, POIs, tours, accommodation and gastronomy |
| GeoSphere Austria | Weather information |
| OpenStreetMap | Geographic information and distances |
| Open-Meteo | Weather forecasts |
| OpenHolidays API | School holiday information |

Additional context:
- Family travel dates.
- Children's age groups: 0–2, 3–6, 7–12 and 13–17.
- Interests and preferences.
- Lift and trail status.
- Opening hours and operational information.

Data availability and integration methods depend on the access provided during the hackathon.

## 🏗️ Technical Concept

The architecture aims to separate data integration, activity matching, itinerary planning and the user experience.

### Main components

1. **Frontend:** Personalised family holiday canvas, discovery and itinerary interface.
2. **Family profile:** Travel dates, children's ages, interests and preferences.
3. **Data integration:** Connect and normalise information from the different tourism systems.
4. **Recommendation engine:** Match activities against family profiles and contextual conditions.
5. **Planning engine:** Build realistic daily itineraries based on time, distance and weather.
6. **Booking integration:** Link users to the appropriate registration and payment flows.
7. **AI layer:** Natural-language interaction and recommendation explanations.

### Hackathon infrastructure

We can leverage the infrastructure provided by buildbar_ and destination.one, where appropriate:

- Next.js starter application.
- n8n workflows.
- one.intelligence AI models.
- Supabase and PostgreSQL.
- MCP integrations.
- TTF Data Space.

The final technology choices will reflect the actual implementation.

## 🎯 MVP – What We Want to Demonstrate

Our primary objective is to demonstrate a complete family journey:

1. A family opens Familienzeit.
2. They create their personal holiday canvas.
3. They enter their holiday dates, children's ages and interests.
4. The application discovers suitable activities across the different sources.
5. The family receives recommendations that account for weather and timing.
6. The application creates a practical daily itinerary.
7. The family can open the original activity details and continue to registration or booking.

**The key demonstration:** One family, one personalised experience, multiple booking systems — without having to search through them individually.

## 🌱 Our Vision

We believe destination experiences should be organised around the guest, not around the systems that store the information.

Familienzeit starts in Serfaus-Fiss-Ladis, but the vision goes beyond a single destination.

The same approach could eventually help tourism regions connect fragmented activity catalogues, booking systems and contextual information into one coherent guest experience.

A family should not need to understand the technology behind a destination to enjoy everything it has to offer.

**Less organising. More experiencing. More Familienzeit.**

---

## 👥 Team

![team.webp](resources/team.webp)

| Name | Role |
|---|---|
| Felix | TBD |
| Eva | TBD |
| Jakob | TBD |
| Niki | TBD |
| Lukas | TBD |

## 🛠️ Getting Started

Setup and installation instructions will be added once the application structure has been finalised.

## 📸 Screenshots & Demo

### Reise-Canvas – Live Prototype

Explore the current prototype:

👉 [familienzeit-canvas-prototyp.dervondenbergen.chatgpt.site](https://familienzeit-canvas-prototyp.dervondenbergen.chatgpt.site/)

Further screenshots and demonstrations will be added as the application evolves.

## 🏆 Hackathon

**Tourism Technology Festival 2026**

- 📍 Messezentrum Salzburg, Austria
- 📅 7–8 November 2026
- ⏱️ 24-hour hackathon

**Selected challenge:** Challenge 06 – One Family Holiday, Four Booking Systems.

**Challenge partner:** Dialogschmiede GmbH / Serfaus-Fiss-Ladis.

Useful resources:
- https://www.tourism-technology.com/
- https://buildbar.at/ttf-2026
- https://www.serfaus-fiss-ladis.at/

---

*Familienzeit – Weniger planen. Mehr gemeinsam erleben.* 🏔️