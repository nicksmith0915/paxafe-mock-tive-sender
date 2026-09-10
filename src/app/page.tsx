import SenderConsoleLoader from '@/components/SenderConsoleLoader';

export default function Home() {
  return (
    <main>
      <header className="masthead">
        <h1>Mock Tive Sender</h1>
        <p>
          Generates Tive telemetry payloads and posts them to the PAXAFE Integration API. Send the
          fixtures shipped with the exercise, or simulate a shipment reporting over time.
        </p>
      </header>
      <SenderConsoleLoader />
      <footer>
        Requests are relayed server-side rather than sent from the browser: the Integration API is a
        server-to-server webhook receiver and does not implement CORS.
      </footer>
    </main>
  );
}
