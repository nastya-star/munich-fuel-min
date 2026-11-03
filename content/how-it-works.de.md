# Wie funktioniert es?

## 01 Einleitung

Hallo, wir kennen uns ja schon. Ich bin Anastasiia.

Ich studiere Mathematik und beschäftige mich seit 2022 mit Optimierungsproblemen. Meistens fängt es mit einer Frage an, auf die ich selbst eine Antwort finden möchte: Welche Route ist am günstigsten? Wie komme ich in möglichst kurzer Zeit an mein Ziel? Wie kann ich meine Katzen möglichst gut ernähren und dabei möglichst wenig Geld ausgeben? Irgendwann habe ich mich gefragt, ob ich mit demselben Ansatz auch Probleme anderer Menschen lösen könnte.

Als ich mein Studium an der TUM begann, lernte ich viele Studierende kennen, und einige fragten immer wieder nach meinen Kontaktdaten. Deshalb wollte ich eine Website haben, auf der man mich finden kann. Gleichzeitig sollte es dort auch etwas geben, für das sich ein Besuch lohnt. Während unserer Einführungstage wurde in einer Online-Umfrage gefragt, worauf sich alle am meisten freuten. Bier bekam dabei die meiste Aufmerksamkeit. Als wir später zusammen ausgingen, stellte ich fest, dass Radler besonders beliebt war. Also beschloss ich, das günstigste Radler in München und Garching zu finden. Das erschien mir als eine durchaus passende Art, mich vorzustellen: Andere brachten Bier zum Treffen mit, ich ein Optimierungsproblem.

Aber München ist voller Menschen, die ihre Einführungstage längst hinter sich haben. Ich lernte Gründerinnen, Gründer und Berufstätige kennen, deren Alltagsfragen über den Preis von Radler hinausgingen. Auch für sie wollte ich etwas Nützliches entwickeln. Die Frage war nur: Was?

Die Antwort kam bei einem Female Founder Breakfast in München. Ich unterhielt mich mit einer der Gründerinnen, als sie erwähnte, dass eine Website mit den günstigsten Tankstellen für sie hilfreich wäre. Die Idee gefiel mir, denn Benzinpreise unterscheiden sich von Tankstelle zu Tankstelle und ändern sich im Laufe des Tages. Die Entscheidung, wo man tankt, ist also ein kleines, aber immer wiederkehrendes Problem. Vor allem hatte mir gerade jemand gesagt, was sie tatsächlich brauchen könnte. Also beschloss ich, es zu bauen.

So entstand **Munich Fuel Minimum**, eine Website, die echte Kraftstoffpreise vergleicht und die günstigsten Tankstellen rund um einen gewählten Standort findet. Aus einem Gespräch beim Frühstück wurden ein mathematisches Problem, eine API-Anbindung und eine interaktive Karte. Ich zeige euch, wie das Ganze funktioniert.

---

## 02 Das Problem

Stellen wir uns vor, wir möchten irgendwo in München tanken. Wir wissen, welchen Kraftstoff wir brauchen, wo wir starten und wie weit wir dafür fahren würden. Innerhalb dieses Gebiets verlangen verschiedene Tankstellen unterschiedliche Preise. Unsere Aufgabe besteht also darin, die Tankstelle zu finden, an der ein Liter am wenigsten kostet. Das lässt sich als **diskretes Minimierungsproblem** formulieren, denn wir wählen aus einer endlichen Menge von Tankstellen.

### 02.1 Eingabedaten

Unser Modell beginnt mit drei Arten von Informationen: dem vom Nutzer gewählten geografischen Gebiet, der zu vergleichenden Kraftstoffart und den von den Tankstellen gemeldeten Preisen. Jede Tankstelle besitzt eine Kennung, einen Namen, geografische Koordinaten, einen gemeldeten Öffnungsstatus und verfügbare Preise für Super E5, Super E10 und Diesel. Der Nutzer wählt einen Startpunkt und einen Suchradius. Zusammen legen sie das Gebiet fest, in dem wir nach geeigneten Tankstellen suchen. Zusätzlich bietet die Anwendung einen Filter für als geöffnet gemeldete Tankstellen, sodass der Nutzer selbst bestimmen kann, welche Stationen in den Vergleich einbezogen werden.

Jemand am Marienplatz möchte beispielsweise das günstigste E10 im Umkreis von fünf Kilometern finden, während sich eine andere Person für Diesel im Umkreis von siebzehn Kilometern interessiert. Die Eingaben unterscheiden sich, aber beide Fragen führen zur selben mathematischen Formulierung.

### 02.2 Zielfunktion

Für eine gewählte Kraftstoffart, einen Standort und einen Suchradius suchen wir den niedrigsten gemeldeten Preis pro Liter:

\[
\boxed{
p_f^*(x,r,t)
=
\min_{i\in S_f(x,r,t)} p_{i,f}(t_i)
}
\]

Dabei bezeichnet \(i\) eine einzelne Tankstelle und \(f\) die Kraftstoffart, also E5, E10 oder Diesel. Der Punkt \(x\) ist der vom Nutzer gewählte Startpunkt, während \(r\) den Suchradius in Kilometern angibt. Mit \(t\) bezeichnen wir den Zeitpunkt des Vergleichs und mit \(t_i\) den Zeitpunkt, zu dem der Preis der Tankstelle \(i\) abgerufen wurde. Der Ausdruck \(p_{i,f}(t_i)\) ist der gemeldete Preis pro Liter für Kraftstoff \(f\) an Tankstelle \(i\), angegeben in Euro.

Die Menge \(S_f(x,r,t)\) enthält alle Tankstellen innerhalb des gewählten Radius, für die ein gültiger Preis der ausgewählten Kraftstoffart vorliegt. Ist der Filter für geöffnete Tankstellen aktiviert, wird diese Menge auf Stationen beschränkt, die als geöffnet gemeldet sind. Schließlich bezeichnet \(p_f^*(x,r,t)\) den niedrigsten gemeldeten Literpreis unter diesen geeigneten Tankstellen – genau den Wert, den wir suchen.

Ein Detail verdient besondere Aufmerksamkeit. Nehmen wir an, drei Tankstellen melden für E10 die Preise 1,729 €, 1,689 € und 1,689 € pro Liter. Das Minimum beträgt 1,689 €, wird aber von zwei Tankstellen erreicht. In der Optimierung unterscheiden wir zwischen dem **optimalen Zielfunktionswert**, also dem niedrigsten Preis, und den **optimalen Lösungen**, also den Tankstellen, an denen dieser Preis erreicht wird. Letztere bilden die Menge der Minimierer, die häufig mit \(\operatorname*{arg\,min}\) beschrieben wird. Diesen Unterschied wollte ich auch auf der Website beibehalten: Sie zeigt alle Tankstellen mit dem niedrigsten Preis an, damit der Besucher die für ihn günstigste Lage auswählen kann.

---

## 03 Der Algorithmus

Nachdem wir wissen, was wir minimieren möchten, brauchen wir ein Verfahren, um das Minimum zu finden. Zum Glück ist die Lösung dieses Problems ziemlich einfach. Stellen wir uns eine Reihe von Tankstellen vor, vor denen jeweils ein Zettel mit dem Preis liegt. Wir beginnen mit dem ersten geeigneten Preis und merken ihn uns als bisheriges Minimum. Danach betrachten wir jeden weiteren Preis, ersetzen unser Minimum, sobald wir etwas Günstigeres finden, und merken uns jede Tankstelle, deren Preis dem Minimum entspricht. Haben wir alle geeigneten Stationen geprüft, kennen wir sowohl den niedrigsten Preis als auch alle Tankstellen, die ihn anbieten.

Dieses Verfahren heißt **lineare Minimumsuche** (*Linear Minimum Search*) und hat die Zeitkomplexität \(O(n)\), wobei \(n\) die Anzahl der geeigneten Tankstellen bezeichnet. Die Zahl der Vergleiche wächst also linear mit der Zahl der Stationen. Für die geografischen Suchgebiete unserer Anwendung ist das gut geeignet. Wir führen die Berechnung unabhängig für Super E5, Super E10 und Diesel durch und verwenden dabei die entsprechenden Preise derselben Tankstellendaten.

Vor der Berechnung bestimmt die Anwendung, welche Tankstellen überhaupt innerhalb des gewählten Suchgebiets liegen. Dazu verwendet sie die Haversine-Formel, um aus den Breiten- und Längengraden die geografische Entfernung zwischen dem Startpunkt und den einzelnen Tankstellen zu berechnen. Anschließend werden die Stationen anhand der Entfernung, der verfügbaren Kraftstoffpreise und des gewählten Öffnungsfilters ausgewählt. Die Preise werden intern als ganze Zahlen in Tausendstel Euro dargestellt: Aus 1,729 € wird beispielsweise 1729. So lassen sich die Werte genau in der von den Daten vorgegebenen Auflösung vergleichen. Nach der Berechnung verwendet die Anwendung dieselben Datensätze für die Preisanzeigen, die Tankstellenliste und die interaktive Karte.

---

## 04 Herkunft der Daten

Die Anwendung verwendet **echte Kraftstoffpreisdaten**, die über die [Tankerkönig-API](https://creativecommons.tankerkoenig.de/) abgerufen werden. In Deutschland melden Tankstellen Änderungen ihrer Kraftstoffpreise an die Markttransparenzstelle für Kraftstoffe, kurz MTS-K, die beim Bundeskartellamt angesiedelt ist. Tankerkönig macht diese Informationen über eine API zugänglich. Dadurch können wir gemeldete Preise für Super E5, Super E10 und Diesel zusammen mit Angaben zu den jeweiligen Tankstellen abrufen.

Eine API-Antwort enthält eine Sammlung von Tankstellen, die durch verschiedene Angaben beschrieben werden, darunter Kennung, Name, Marke, Adresse, geografische Koordinaten, gemeldeter Öffnungsstatus und Kraftstoffpreise. Bevor die Daten in die Minimierung eingehen, überführt die Anwendung die Einträge in ein einheitliches internes Format. Die Tankstellenkennungen bleiben erhalten, die Preise werden in ganze Tausendstel Euro umgewandelt und den Beobachtungen werden Abrufzeitpunkte zugeordnet. So lassen sich die Preise einzelner Stationen vergleichen und gemeinsam mit der Information anzeigen, wann sie abgerufen wurden.

Manche Tankstellen bieten nur bestimmte Kraftstoffarten an, während bei anderen Einträgen einzelne Preise fehlen oder nicht verfügbar sind. Die Anwendung stellt diese Werte als `null` dar und berücksichtigt eine Tankstelle bei der Minimierung nur für die Kraftstoffarten, für die ein gültiger gemeldeter Preis vorliegt. So kann eine Station mit verfügbarem Dieselpreis am Dieselvergleich teilnehmen, selbst wenn ihr E5-Preis fehlt. Auf der Karte bleibt dieselbe Station sichtbar; der fehlende Preis erhält dort eine eigene visuelle Kennzeichnung. Auf diese Weise arbeitet die Anwendung mit den tatsächlich von Tankerkönig gelieferten Informationen und bildet für jede Kraftstoffart die passende Menge geeigneter Tankstellen.

---

## 05 Wie eine Anfrage durch das System läuft

Wir haben nun eine mathematische Zielfunktion, einen Algorithmus und eine Quelle für echte Preise. Jetzt müssen wir diese Teile so miteinander verbinden, dass jemand die Website benutzen kann, ohne etwas über Optimierung wissen zu müssen. Ich wollte, dass Besucher die Seite öffnen, einen Standort auswählen, Preise vergleichen und anschließend entscheiden können, wo sie tanken möchten. Genau dieser Reihenfolge folgt die Bedienung.

Wenn ihr [Munich Fuel Minimum](https://nastya-star.github.io/munich-fuel-min/) öffnet, beginnt die Website mit dem Marienplatz in München als voreingestelltem Startpunkt oder stellt den Standort wieder her, den ihr zuvor im Browser gespeichert habt. Sie zeigt drei Kraftstoff-Preiskarten, eine interaktive Karte und die Optionen zur Auswahl des Suchgebiets. Ihr könnt eine Adresse, einen Ort oder eine Postleitzahl eingeben und auf **Suchen** klicken. Anschließend schlägt die Website mithilfe des Nominatim-Dienstes von OpenStreetMap passende Orte vor. Sobald ihr einen davon auswählt, wird er zum Startpunkt. Alternativ könnt ihr über **Meinen Standort verwenden** dem Browser erlauben, euren aktuellen Standort zu bestimmen. Danach wählt ihr einen Radius von 5, 10 oder 17 Kilometern und entscheidet, ob alle Tankstellen oder nur die als geöffnet gemeldeten Stationen berücksichtigt werden sollen.

Die Website ruft die relevanten Tankstellendaten ab und berechnet die Mindestpreise für E5, E10 und Diesel. Die drei Preiskarten zeigen diese Ergebnisse an, während die Karte die Tankstellen zunächst entsprechend der ausgewählten Kraftstoffart einfärbt. Wenn ihr auf eine andere Kraftstoffkarte klickt, ändert sich der Vergleich auf der Karte. So könnt ihr alle drei Kraftstoffarten anhand der bereits abgerufenen Informationen betrachten. Ein Klick auf eine Tankstellenmarkierung öffnet die Details mit Adresse, gemeldetem Preis, Entfernung vom Startpunkt und Abrufzeit. Über die Tankstellenliste könnt ihr dieselben Daten auf andere Weise erkunden: Ihr könnt nach Namen oder Marken suchen, nach Preis oder Entfernung sortieren und eine Station auswählen, um sie auf der Karte zu finden. Habt ihr euch entschieden, öffnet die Schaltfläche **Route planen** Google Maps mit eurem Startpunkt und der gewählten Tankstelle als Ziel.

### 05.1 Die Architektur

Hinter dieser Bedienung steht eine Abfolge von Komponenten: **GitHub Pages → Cloudflare Worker → Tankerkönig-API → Preisberechnung → interaktive Karte**. Die Website selbst besteht aus HTML, CSS und JavaScript und wird über GitHub Pages bereitgestellt. Sobald Kraftstoffpreise benötigt werden, sendet der Browser eine Anfrage an einen Cloudflare Worker. Dieser kommuniziert mit Tankerkönig über einen API-Schlüssel, der als serverseitiges Secret gespeichert ist. Der Worker ruft die Tankstellendaten ab und verarbeitet sie, während der Browser aus den zurückgegebenen Datensätzen die Mindestpreise berechnet und die Ergebnisse auf der Website darstellt.

Dabei gibt es eine wichtige technische Vorgabe: **Tankerkönig sieht für den API-Schlüssel höchstens eine API-Anfrage innerhalb von 60 Sekunden vor.** Da mehrere Menschen die Website gleichzeitig verwenden können, müssen ihre Anfragen koordiniert werden. Dafür setze ich ein Cloudflare Durable Object ein, das ein gemeinsames Anfragelimit verwaltet und bereits abgerufene Tankstellendaten zwischenspeichert. Fragt jemand ein Gebiet ab, für das geeignete aktuelle Beobachtungen im Cache liegen, verwendet das System diese Daten erneut. Werden neue Informationen benötigt und ist die nächste Anfrage zulässig, ruft der Worker neue Daten von Tankerkönig ab. So können verschiedene Besucher dieselbe API-Anbindung nutzen, während das System die Häufigkeit der Anfragen, die geografische Abdeckung und die Abrufzeitpunkte berücksichtigt.

Die Umsetzung verbindet damit **HTML und CSS** für die Benutzeroberfläche, **JavaScript** für die Datenverarbeitung und Minimierung, **GitHub Pages** für das Hosting, **Cloudflare Workers und Durable Objects** für die API-Kommunikation und Anfragenkoordination sowie **Leaflet und OpenStreetMap** für die geografische Darstellung. Der Code befindet sich in meinem [öffentlichen GitHub-Repository](https://github.com/nastya-star/munich-fuel-min), wo sich die mathematischen Berechnungen und die technische Umsetzung nachvollziehen und reproduzieren lassen.

---

## 06 Datenschutz

Um Tankstellen in der Nähe zu finden, benötigt die Anwendung einen Startpunkt. Dabei stellt sich eine interessante Frage: Wie genau muss eigentlich jede Komponente den Standort kennen? Der Browser braucht den vom Besucher gewählten Punkt, um Entfernungen zu berechnen und eine Route zu erstellen. Für die API-Anfrage reicht dagegen ein ungefähres geografisches Gebiet aus. Deshalb habe ich diese beiden Aufgaben voneinander getrennt: Der genaue Startpunkt bleibt für die Berechnungen im Browser verfügbar, während die an den Cloudflare Worker übermittelten Koordinaten auf ein Raster von ungefähr einem Kilometer gerundet werden.

Der Suchradius wird so angepasst, dass die durch das Runden entstehende Verschiebung berücksichtigt wird und der Worker ein passendes Gebiet um die angenäherten Koordinaten abfragen kann. Zusätzlich normalisiert der Worker die eingehenden Koordinaten, damit Anfragen und zwischengespeicherte Daten serverseitig einheitlich verarbeitet werden. Der Browser kann währenddessen weiterhin die Entfernungen vom tatsächlich gewählten Startpunkt berechnen und diesen Punkt an Google Maps übergeben, wenn eine Route erstellt wird. Für die Adresssuche wird Nominatim verwendet, das eingegebene Orte in geografische Koordinaten umwandelt. Der ausgewählte Startpunkt und der Suchradius können außerdem im lokalen Speicher des Browsers abgelegt werden, sodass bei einem späteren Besuch wieder mit demselben Gebiet begonnen werden kann.

Mir gefiel an dieser Lösung, dass sie sich unmittelbar aus der Architektur ergibt. Der Standort, mit dem Preise abgerufen werden, und der Standort, von dem aus die Fahrt des Besuchers berechnet wird, erfüllen unterschiedliche Aufgaben. Also können sie auch getrennt behandelt werden.

---

## 07 Visualisierung

Sobald das Minimum berechnet ist, kennen wir die Antwort auf unser mathematisches Problem. Ich wollte aber, dass man das Ergebnis auf einen Blick versteht. Eine Liste von Preisen verrät uns, welche Tankstelle am günstigsten ist, während eine Karte zusätzlich zeigt, wo sich die Stationen befinden und wie sich ihre Preise im gewählten Gebiet unterscheiden. Für die Darstellung verwende ich Leaflet und OpenStreetMap. Jede Tankstellenmarkierung erhält eine Farbe entsprechend dem gemeldeten Preis für die gewählte Kraftstoffart. Tankstellen, die das Minimum erreichen, erscheinen **grün mit einem Häkchen**, während höhere Preise von **Gelb über Orange bis Rot** dargestellt werden. Stationen, für die der Preis der ausgewählten Kraftstoffart fehlt, erscheinen **grau**; Tankstellen mit demselben Preis erhalten dieselbe Farbe.

Die Farbskala wird aus den verschiedenen Preisen berechnet, die im jeweiligen Vergleich vorkommen. Melden beispielsweise mehrere Tankstellen 1,689 €, bekommen sie dieselbe Farbe, während der nächsthöhere gemeldete Preis die nächste Position in der Skala erhält. Wechselt der Besucher von E10 zu Diesel, berechnet die Anwendung die Farben anhand der Dieselpreise neu. So zeigt dieselbe Karte ein anderes Minimierungsproblem. Decken die verfügbaren Daten nur einen Teil des gewünschten Gebiets ab, kennzeichnet die Karte den Vergleich als unvollständig und stellt die beobachteten Preise dar, ohne ein bestätigtes Minimum für das gesamte Suchgebiet hervorzuheben. Auf diese Weise bleibt die Visualisierung mit dem mathematischen Ergebnis und der geografischen Abdeckung der Beobachtungen verbunden.

Außerdem habe ich die Karte mit der Tankstellenliste verknüpft, damit beide Ansichten dieselbe Sammlung von Stationen zeigen. Ein Klick auf eine Markierung öffnet die Details; wählt man eine Station in der Liste aus, wird sie auf der Karte hervorgehoben. Besucher können Stationen betrachten, Preise vergleichen und zwischen Kraftstoffarten wechseln, während sie mit den bereits geladenen Daten arbeiten. Aus einem Minimum über einer Menge von Preisen wird so ein geografischer Vergleich, mit dem man ein tatsächliches Ziel auswählen kann.

---

## 08 Zukünftige Verbesserungen

Derzeit löst das Projekt ein statisches Minimierungsproblem mit den Kraftstoffpreisen, die von Tankerkönig abgerufen werden. Ich möchte es um eine **Preisprognose** erweitern, denn Kraftstoffpreise verändern sich im Laufe des Tages, und die günstigste Tankstelle kann später einen anderen Preis anbieten. Statt nur zu fragen, wo Kraftstoff gerade am günstigsten ist, könnten wir untersuchen, wo er voraussichtlich in dreißig Minuten, in einigen Stunden oder am nächsten Tag am günstigsten sein wird. Damit käme die Zeit als weitere Entscheidungsvariable hinzu, und aus dem ursprünglichen Preisvergleich würde ein interessanteres Optimierungsproblem.

Für diese Prognosen möchte ich verschiedene Verfahren vergleichen, beginnend mit linearer Regression und klassischen Zeitreihenmodellen wie ARIMA. Außerdem interessieren mich Gradient-Boosting-Modelle wie LightGBM und XGBoost sowie probabilistische Modelle, mit denen sich der Zeitpunkt von Preisänderungen abschätzen lässt. Um diese Methoden zu untersuchen, benötige ich historische Kraftstoffpreisbeobachtungen, möglichst mit Zeitstempeln und Werten einzelner Preisänderungen. Ich prüfe derzeit, wie ich über Tankerkönig Zugang zu historischen Daten bekommen kann, um Preisverläufe zu rekonstruieren, Muster einzelner Tankstellen zu untersuchen und die Vorhersagequalität verschiedener Modelle zu vergleichen.

Mit einem Prognosemodell könnten wir sowohl die Tankstelle als auch den Zeitpunkt des Tankens auswählen. Beispielsweise könnte der prognostizierte Preis \(\widehat p_{i,f}(\tau)\) den erwarteten Preis für Kraftstoff \(f\) an Tankstelle \(i\) zum zukünftigen Zeitpunkt \(\tau\) beschreiben. Damit ließen sich verschiedene Stationen und Tankzeiten vergleichen. Anschließend könnten wir zusätzliche Kosten berücksichtigen, etwa die Entfernung zur Tankstelle, den Kraftstoffverbrauch auf dem Weg und den Zeitaufwand des Fahrers. Aus dem ursprünglichen Problem des niedrigsten Literpreises könnte allmählich ein Entscheidungssystem werden, das dabei hilft, **wo und wann man tanken sollte**.

Besonders interessant finde ich daran, dass alles mit einer Frage begann, die mir jemand beim Frühstück stellte. Aus einem kleinen Alltagsproblem entstanden eine mathematische Formulierung, eine funktionierende Website und mehrere Möglichkeiten für weitere Forschung. Genau deshalb mag ich Optimierung: Eine einfache Frage kann viel interessanter werden, sobald man beginnt, sie genauer zu untersuchen.

---

## Hast du ein Problem, das sich optimieren lässt?

Ich sammle interessante Optimierungsprobleme aus der Mathematik, der Forschung, der Wirtschaft und aus Alltagsgesprächen. Manche beginnen mit einer komplizierten technischen Frage, andere entstehen, wenn jemand beiläufig von einer Schwierigkeit erzählt, die er gern lösen würde. Wenn du ein Problem hast, bei dem es um Kosten, Ressourcen, Planung oder Entscheidungen geht, würde ich gern davon hören. Vielleicht lässt sich daraus ein weiteres mathematisches Modell machen – und vielleicht wird es mein nächstes kleines Projekt.

[Lass uns auf LinkedIn über Optimierung sprechen](https://www.linkedin.com/in/anastasiia-stepanenko-1a0871327/).

---

Danke, dass du auch diese mathematische Ecke meiner Website besucht hast. Ich hoffe, dass der Preisvergleich beim nächsten Tanken ein bisschen einfacher wird und die Fahrt vielleicht ein paar Euro günstiger.

Mit bewundernden Grüßen,  
**Anastasiia**

*P.S. Mit Liebe gemacht.*
