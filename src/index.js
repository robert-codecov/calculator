import React from "react";
import ReactDOM from "react-dom";
import "./index.css";
import foo from "./foo.js";

export default class App extends React.Component {
  state = {
    counter: 0,
  };

  increment = () => {
    var i = 0;

    while (i < 1000) {
      i = i + 1;
    }

    foo()

    const next = this.state.counter + 1;

    this.setState({ counter: next });
  };

  render() {
    return (
      <div className="component-app">
        <button onClick={this.increment}>Call function</button>
      </div>
    );
  }
}

ReactDOM.render(<App />, document.getElementById("root"));
