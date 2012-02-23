Meteor.startup(function () {
  test.setReporter(reportResults);
  test.run();
});

Template.test_table.data = function() {
  var cx = Meteor.deps.Context.current;
  if (cx) {
    resultDeps.push(cx);
  }

  return resultTree;
};

Template.test.test_status_display = function() {
  var status = _testStatus(this);
  if (status == "failed") {
    return "FAIL";
  } else if (status == "succeeded") {
    return "PASS";
  } else {
    return "waiting...";
  }
};

Template.test.test_time_display = function() {
  var time = _testTime(this);
  return (typeof time === "number") ? time + " ms" : "";
};

Template.test.test_class = function() {
  var events = this.events || [];
  var classes = [_testStatus(this)];

  if (this.expanded) {
    classes.push("expanded");
  } else {
    classes.push("collapsed");
  }

  return classes.join(' ');
};

Template.test.events = {
  'click .testname': function() {
    this.expanded = ! this.expanded;
    _resultsChanged();
  }
};

Template.test.eventsArray = function() {
  var events = _.filter(this.events, function(e) {
    return e.type != "finish";
  });

  var partitionBy = function(seq, func) {
    var result = [];
    var lastValue = {};
    _.each(seq, function(x) {
      var newValue = func(x);
      if (newValue === lastValue) {
        result[result.length-1].push(x);
      } else {
        lastValue = newValue;
        result.push([x]);
      }
    });
    return result;
  };

  var dupLists = partitionBy(
    _.map(events, function(e) {
      // XXX XXX We need something better than stringify!
      // stringify([undefined]) === "[null]"
      return {obj: e, str: JSON.stringify(e)};
    }), function(x) { return x.str; });

  return _.map(dupLists, function(L) {
    var obj = L[0].obj;
    return (L.length > 1) ? _.extend({times: L.length}, obj) : obj;
  });
};

Template.event.events = {
  'click .debug': function () {
    // the way we manage groupPath, shortName, cookies, etc, is really
    // messy. needs to be aggressively refactored.
    forgetEvents({groupPath: this.cookie.groupPath,
                  test: this.cookie.shortName});
    test.debug(this.cookie);
  }
};

Template.event.get_details = function() {
  var details = this.details;
  if (! details) {
    return null;
  } else {
    // XXX XXX We need something better than stringify!
    // stringify([undefined]) === "[null]"
    return JSON.stringify(details);
  }
};

Template.event.is_debuggable = function() {
  return !!this.cookie;
};


var resultTree = [];
var resultDeps = [];

var _resultsChanged = function() {
  _.each(resultDeps, function(cx) {
    cx.invalidate();
  });
  resultDeps.length = 0;
};

var _testTime = function(t) {
  if (t.events && t.events.length > 0) {
    var lastEvent = _.last(t.events);
    if (lastEvent.type === "finish") {
      if ((typeof lastEvent.timeMs) === "number") {
        return lastEvent.timeMs;
      }
    }
  }
  return null;
};

var _testStatus = function(t) {
  var events = t.events || [];
  if (events.length == 0 || (_.last(events).type != "finish" &&
                             _.last(events).type != "exception")) {
    return "running";
  } else if (_.any(events, function(e) {
    return e.type == "fail" || e.type == "exception"; })) {
    return "failed";
  } else {
    return "succeeded";
  }
};

// given a 'results' as delivered via setReporter, find the
// corresponding leaf object in resultTree, creating one if it doesn't
// exist. it will be an object with attributes 'name', 'parent', and
// possibly 'events'.
var _findTestForResults = function (results) {
  var groupPath = results.groupPath; // array

  if ((! _.isArray(groupPath)) || (groupPath.length < 1)) {
    throw new Error("Test must be part of a group");
  }

  var group;
  _.each(groupPath, function(gname) {
    var array = (group ? (group.groups || (group.groups = []))
                 : resultTree);
    var newGroup = _.find(array, function(g) { return g.name === gname; });
    if (! newGroup) {
      newGroup = {name: gname, parent: (group || null)}; // create group
      array.push(newGroup);
    }
    group = newGroup;
  });

  var testName = results.test;
  var server = !!results.server;
  var test = _.find(group.tests || (group.tests = []),
                    function(t) { return t.name === testName &&
                                  t.server === server; });
  if (! test) {
    // create test
    test = {name: testName, parent: group, server: server};
    group.tests.push(test);
  }

  return test;
};

// report a series of events in a single test, or just
// the existence of that test if no events
var reportResults = function(results) {
  var test = _findTestForResults(results);


  if (_.isArray(results.events)) {
    // append events, if present
    Array.prototype.push.apply((test.events || (test.events = [])),
                               results.events);
  }

  _.defer(_throttled_update);
};

// forget all of the events for a particular test
var forgetEvents = function (test) {
  var test = _findTestForResults(test);

  delete test.events;
  _resultsChanged();
};

var _throttled_update = _.throttle(function() {
  _resultsChanged();
  Meteor.flush();
}, 500);