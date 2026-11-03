# How does it work?

*A transparent fuel-price comparison system for Munich, designed for accuracy, privacy and reproducibility.*

## 01 Introduction

Hi, we already know each other. I'm Anastasiia.

I study mathematics, and since 2022, I've been working on optimization problems, usually beginning with questions I wanted to answer for myself: What is the cheapest route? How can I travel somewhere in the shortest possible time? How can I feed my cats as well as possible while spending as little as possible? Eventually, I began wondering whether I could use the same approach to solve problems for other people.

When I started at TUM, I met many students, and quite a few began asking for my contact details. I thought it would be useful to have a website where they could find me, but I also wanted to give them something worth visiting. During our introductory days, an online questionnaire asked what everyone was looking forward to most, and beer received the most attention. Later, when we went out together, I noticed that Radler was a particular favorite. So I decided to find the cheapest Radler in Munich and Garching. It seemed an appropriate way to introduce myself: other people brought beer to the gathering, while I brought an optimization problem.

But Munich is full of people who have already survived their introductory days. I was meeting founders, professionals and people whose everyday concerns extended beyond the price of Radler. I wanted to create something useful for them too. The question was what.

The answer came during a Female Founder Breakfast in Munich. I was talking to one of the founders when she mentioned that a website showing the cheapest petrol stations would be useful to her. I liked the idea because petrol prices vary between stations and change throughout the day, which makes the choice of where to refuel a small but recurring decision. More importantly, someone had just told me what she actually needed. So I decided to build it.

The result is **Munich Fuel Minimum**, a website that compares real petrol prices and finds the cheapest stations around a selected location. What started as a conversation over breakfast became a mathematical problem, an API integration and an interactive map. Let me explain how it works.

---

## 02 The problem

Suppose we want to refuel somewhere in Munich. We have a particular fuel type in mind, a starting location and some distance we are willing to travel. Within that area, different petrol stations offer different prices, so our task is to identify the station at which one liter costs the least. We can express this as a **discrete minimization problem**, since we are choosing from a finite collection of petrol stations.

### 02.1 Input

Our model begins with three kinds of information: the geographical area selected by the user, the fuel type being compared and the prices reported by petrol stations. Each station has an identifier, a name, geographical coordinates, a reported opening status and available prices for Super E5, Super E10 and Diesel. The user selects a starting location and a search radius, which together define the geographical area in which we look for eligible stations. The application also offers a filter for stations reported as open, so the user can decide which stations should participate in the comparison.

For example, a person near Marienplatz may want to find the cheapest E10 within five kilometers, while someone else may be interested in Diesel within seventeen kilometers. Although the inputs differ, both questions lead to the same mathematical formulation.

### 02.2 Objective function

For a selected fuel type, location and search radius, we want to find the lowest reported price per liter:

\min\_{i\in S_f(x,r,t)}\
p\_{i,f}(t_i)\
}\
]

Here, (i) identifies an individual petrol station and (f) represents the fuel type: E5, E10 or Diesel. The point (x) is the starting location selected by the user, while (r) represents the search radius in kilometers. We use (t) for the time at which the comparison is performed and (t_i) for the time at which station (i)'s price was retrieved. The expression (p\_{i,f}(t_i)) is the reported price per liter for fuel (f) at station (i), expressed in euros.

The set (S_f(x,r,t)) contains the stations within the chosen radius that have a valid reported price for the selected fuel. When the open-stations filter is enabled, this set is restricted to stations reported as open. Finally, (p_f^\*(x,r,t)) represents the minimum reported price per liter among these eligible stations, which is the value we are looking for.

There is one detail worth considering. Suppose three stations report E10 prices of €1.729, €1.689 and €1.689 per liter. The minimum is €1.689, but two stations attain it. In optimization, we distinguish between the **optimal objective value**, which is the minimum price, and the **optimal solutions**, which are the stations attaining that value. The latter form the set of minimizers, often expressed using (\operatorname\*{arg,min}). I wanted the website to preserve this distinction, so it identifies all stations sharing the minimum, leaving the visitor to choose whichever is more convenient.

---

## 03 The algorithm

Now that we know what we want to minimize, we need a way to find it. Fortunately, this problem has a straightforward solution. Imagine a row of petrol stations, each with its price written on a piece of paper. We begin with the first eligible price and remember it as our current minimum. Then we examine each subsequent price, replacing the current minimum whenever we find something cheaper and remembering every station whose price equals the minimum. Once we have examined all eligible stations, we have both the lowest price and the collection of stations offering it.

This procedure is called **Linear Minimum Search**, and its time complexity is (O(n)), where (n) represents the number of eligible stations. The number of comparisons grows linearly with the number of stations, making the algorithm suitable for the geographical areas considered by the application. We apply the procedure independently to Super E5, Super E10 and Diesel, using the corresponding prices from the same collection of station records.

Before calculating the minimum, the application determines which stations belong to the selected search area. It uses the Haversine formula to calculate geographical distances between the starting point and each station from their latitude and longitude. The eligible stations are then selected according to the distance, fuel availability and opening-status filter. Prices are represented internally as integer thousandths of a euro, so €1.729 becomes 1729, allowing comparisons at the precision provided by the data. Once the minimum has been calculated, the application uses the same station records to produce the price cards, station list and interactive map.

---

## 04 Data origin

The application uses **real fuel-price data** obtained through the [Tankerkönig API](https://creativecommons.tankerkoenig.de/). In Germany, petrol stations report fuel-price changes to the Markttransparenzstelle für Kraftstoffe, abbreviated as MTS-K, which is operated by the Bundeskartellamt. Tankerkönig provides access to this information through an API, making it possible to retrieve reported prices for Super E5, Super E10 and Diesel together with information about the stations offering them.

An API response contains a collection of petrol stations, each described by several fields, including its identifier, name, brand, address, geographical coordinates, reported opening status and fuel prices. The application converts these records into a consistent internal format before using them in the minimization. Station identifiers are preserved, prices are converted into integer thousandths of a euro, and retrieval timestamps are associated with the observations. This allows prices from individual stations to be compared and displayed together with information about when they were retrieved.

Some petrol stations offer only certain fuel types, while other records contain missing or unavailable prices. The application represents these values as `null` and includes each station in the minimization only for fuels with a valid reported price. For example, a station with an available Diesel price can participate in the Diesel comparison even when its E5 price is unavailable. The same station can still appear on the map, where the unavailable fuel price receives a separate visual representation. This approach allows the application to work with the actual information returned by Tankerkönig and construct the appropriate set of eligible stations for each fuel type.

---

## 05 How a request travels through the system

We now have a mathematical objective, an algorithm and a source of real prices. The remaining task is to connect them in a way that someone can use without knowing anything about optimization. I wanted the visitor to be able to open the website, choose a location, compare the prices and decide where to refuel, so the interaction follows that sequence.

When you open [Munich Fuel Minimum](https://nastya-star.github.io/munich-fuel-min/), the website begins with Marienplatz in Munich as its default starting point, or restores the location previously saved in your browser. The application displays three fuel-price cards, an interactive map and the options for selecting a search area. You can enter an address, town or postcode and press Search, after which the website uses OpenStreetMap's Nominatim service to suggest matching locations. Once you select a place, it becomes your starting point. Alternatively, the **Use my location** button asks your browser for permission to obtain your current location. You can then select a radius of 5, 10 or 17 kilometers and decide whether the comparison should include all stations or only those reported as open.

The website retrieves the relevant station data and calculates the minimum prices for E5, E10 and Diesel. The price cards display these results, while the map initially shows stations colored according to the selected fuel. Clicking another fuel card changes the comparison shown on the map, allowing you to examine the three fuel types using the information already retrieved. Selecting a station marker opens its details, including the address, reported price, distance from the starting point and retrieval time. The station list offers another way to explore the same information: you can search by name or brand, sort by price or distance, and select a station to locate it on the map. Once you have chosen a station, the Directions button opens Google Maps with your starting point and the selected petrol station as the destination.

### 05.1 The architecture

Behind this interaction, the system follows a sequence of components: **GitHub Pages → Cloudflare Worker → Tankerkönig API → price calculation → interactive map**. The website itself is built with HTML, CSS and JavaScript and hosted on GitHub Pages. When prices are needed, the browser sends a request to a Cloudflare Worker, which communicates with Tankerkönig using an API key stored as a server-side secret. The Worker retrieves and processes the station information, while the browser uses the returned records to calculate the minimum prices and display them through the interface.

There is an important technical condition: **Tankerkönig specifies a limit of one API request per 60 seconds for the API key**. Since multiple visitors can use the website simultaneously, the requests need to be coordinated. For this purpose, I use a Cloudflare Durable Object, which manages a shared request limit and a cache of previously retrieved station data. When a visitor requests an area covered by suitable recent observations, the system reuses them. When new information is needed and another upstream request is permitted, the Worker retrieves fresh data from Tankerkönig. This allows different visitors to share the same API connection while the system keeps track of request frequency, geographical coverage and retrieval times.

The implementation therefore combines **HTML and CSS** for the interface, **JavaScript** for price processing and minimization, **GitHub Pages** for hosting, **Cloudflare Workers and Durable Objects** for API communication and request coordination, and **Leaflet with OpenStreetMap** for geographical visualization. The code is available in my [public GitHub repository](https://github.com/nastya-star/munich-fuel-min), where the mathematical calculations and technical implementation can be inspected and reproduced.

---

## 06 Privacy

The application needs a starting location to find nearby petrol stations, which raises an interesting question: how much location information does each component actually need? The browser needs the location selected by the visitor to calculate distances and generate directions, while the API request can work with an approximate geographical area. I therefore separated these two uses of location information so that the precise starting point remains available for calculations in the browser, while the coordinates sent to the Cloudflare Worker are rounded to a grid of approximately one kilometer.

The search radius is adjusted to account for the change introduced by rounding, allowing the Worker to request a suitable area around the approximate coordinates. The Worker also normalizes incoming coordinates, ensuring that the server-side request and cache use a consistent geographical representation. Meanwhile, the browser can calculate distances from the visitor's actual selected starting point and pass that point to Google Maps when generating directions. Address searches are handled through Nominatim, which resolves the place entered by the user into geographical coordinates. The selected starting point and radius can also be saved in the browser's local storage, making it possible to return to the same search area on a later visit.

What I liked about this arrangement was that it followed naturally from the architecture. The location used to retrieve prices and the location used to calculate a visitor's journey serve different purposes, so they can be handled separately.

---

## 07 Visualization

Once the minimum has been calculated, we have the answer to our mathematical problem, but I wanted to make the result understandable at a glance. A list of prices tells us which station is cheapest, while a map shows where those stations are and how their prices compare across the selected area. I used Leaflet and OpenStreetMap to display the stations, assigning each marker a color according to the reported price for the chosen fuel. Stations attaining the minimum are marked in **green with a check mark**, while higher prices are represented from **yellow through orange to red**. Stations with an unavailable price for the selected fuel are shown in **grey**, and stations reporting the same price receive the same color.

The color scale is calculated from the distinct prices present in the comparison. For example, if several stations report €1.689, they receive the same color, while the next higher reported price is assigned the next position in the scale. When the visitor switches from E10 to Diesel, the application recalculates the colors using the Diesel prices, allowing the same map to represent a different minimization problem. When the available data covers only part of the requested area, the map identifies the comparison as incomplete and represents the observed prices without highlighting a confirmed minimum for the entire search area. In this way, the visual representation follows the mathematical result and the geographical coverage of the underlying observations.

I also connected the map to the station list so that both views describe the same collection of stations. Clicking a marker opens its details, while selecting a station in the list highlights it on the map. The visitor can examine stations, compare prices and switch fuel types using the data already loaded. What began as a minimum over a set of prices becomes a geographical comparison that can be used to choose an actual destination.

---

## 08 Future improvements

The current project solves a static minimization problem using the fuel prices retrieved from Tankerkönig. I would like to extend it by introducing **price prediction**, since petrol prices change throughout the day and the cheapest station at one moment may offer a different price later. Instead of asking only where fuel is currently cheapest, we could investigate where it is likely to be cheapest in thirty minutes, several hours or the following day. This would introduce time as an additional decision variable and turn the original comparison into a more interesting optimization problem.

For forecasting, I would like to compare several approaches, beginning with linear regression and classical time-series models such as ARIMA. I am also interested in gradient-boosted decision trees, including LightGBM and XGBoost, and probabilistic models that estimate the timing of price changes. To investigate these methods, I would need historical fuel-price observations, preferably including the timestamps and values of individual price changes. I am exploring access to historical data through Tankerkönig so that I can reconstruct price histories, examine patterns at individual stations and evaluate how well different models predict future prices.

With a forecasting model, we could choose both a station and a time to refuel. For example, the predicted price (\widehat p\_{i,f}(\tau)) could describe the expected price of fuel (f) at station (i) at a future time (\tau), allowing us to compare different stations and refueling times. We could then introduce additional costs, such as the distance to each station, the fuel consumed during the journey and the value of the driver's time. The original minimum-price problem would gradually develop into a decision-support system for choosing **where and when to refuel**.

I find this development particularly interesting because it began with a question someone asked me over breakfast. A small everyday problem led to a mathematical formulation, a working website and several possibilities for further research. That is one of the reasons I enjoy optimization: a simple question can become much more interesting once we begin examining it carefully.

---

## Have a problem worth optimizing?

I collect interesting optimization problems from mathematics, research, business and everyday conversations. Some begin with a complicated technical question, while others appear when someone mentions an inconvenience they would like to solve. If you have a problem involving costs, resources, planning or decisions, I would be interested to hear about it. Perhaps we can turn it into another mathematical model, and perhaps it will become my next little project.

[Let's talk optimization on LinkedIn](https://www.linkedin.com/in/anastasiia-stepanenko-1a0871327/).

---

Thank you for reaching another mathematical corner of my website. I hope the next time you need petrol, the comparison will be a little easier and the journey a little cheaper.

Yours, admiringly,\
**Anastasiia**

*P.S. Made with love.*