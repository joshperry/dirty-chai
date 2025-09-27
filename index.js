export default function dirtyChai(chai, util) {
  var DEFERRED = '__deferred__';

  var flag = util.flag,
      Assertion = chai.Assertion;

  // Defer some chain operation
  function defer(ctx, deferFunc) {
    // See if we have any deferred asserts
    var deferred = flag(ctx, DEFERRED) || [];

    deferred.push(deferFunc);

    flag(ctx, DEFERRED, deferred);
  }

  // Grab and assert on any deferred operations
  function execDeferred(ctx) {
    var deferreds = flag(ctx, DEFERRED) || [],
        root = ctx,
        deferred;

    // Clear the deferred asserts
    flag(ctx, DEFERRED, undefined);
    
    while((deferred = deferreds.shift())) {
      var result = deferred.call(root);
      if(result !== undefined) {
        root = result;
      }
    }

    return root;
  }

  function applyMessageToLastDeferred(ctx, msg) {
    var deferreds = flag(ctx, DEFERRED);
    if(deferreds && deferreds.length > 0) {
      deferreds.splice(-1, 0, function() {
        flag(this, 'message', msg);
      });
    }
  }

  function convertAssertionPropertyToChainMethod(name, getter) {
    if(getter) {
      Assertion.addChainableMethod(name, 
        function newMethod(msg) {
          if(msg) { applyMessageToLastDeferred(this, msg); }
          
          // Execute any deferred asserts when the method is executed
          return execDeferred(this);
        },
        function newProperty() {
          // Flag deferred assert here
          defer(this, getter);
          return this;
        });
    }
  }

  /**
   * Checks to see if a getter calls the `this.assert` function
   *
   * This is not super-reliable since we don't know the required
   * preconditions for the getter. A best option would be for chai
   * to differentiate between asserting properties and ones that only chain.
   */
  function callsAssert(getter) {
    var stub = {
      assertCalled: false,
      assert: function() {
        this.assertCalled = true;
      }
    };

    try {
      getter.call(stub);
    } catch(e) {
      // This most likely happened because we don't meet the getter's preconditions
      // Error on the side of conversion
      stub.assertCalled = true;
    }

    return stub.assertCalled;
  }

  // Get a list of all the assertion object's properties
  var properties = Object.getOwnPropertyNames(Assertion.prototype)
    .map(function(name) { var descriptor = Object.getOwnPropertyDescriptor(Assertion.prototype, name); descriptor.name = name; return descriptor; });

  // For all pure function assertions, exec deferreds before the original function body.
  properties
    .filter(function(property) { return property.name !== 'assert' && property.name !== 'constructor' && typeof property.value === 'function'; })
    .forEach(function(property) {
      Assertion.overwriteMethod(property.name, function(_super) {
        return function() {
          var result = execDeferred(this);
          return _super.apply(result, arguments);
        };
      });
    });

  // For chainable methods, defer the getter, exec deferreds before the assertion function
  properties
    .filter(function(property) { return Assertion.prototype.__methods.hasOwnProperty(property.name); })
    .forEach(function(property) {
      Assertion.overwriteChainableMethod(property.name, function(_super) {
        return function() {
          // Method call of the chainable method
          var result = execDeferred(this);
          return _super.apply(result, arguments);
        };
      }, function(_super) {
        return function() {
          // Getter of chainable method
          defer(this, _super);
          return this;
        };
      });
    });

  var getters = properties.filter(function(property) { 
    return property.name !== '_obj' &&
    typeof property.get === 'function' &&
    !Assertion.prototype.__methods.hasOwnProperty(property.name);
  });

  // For all pure properties, defer the getter
  getters
    .filter(function(property) { return !callsAssert(property.get); })
    .forEach(function(property) {
      Assertion.overwriteProperty(property.name, function(_super) {
        return function() {
          defer(this, _super);
          return this;
        };
      });
    });

  // For all assertion properties, convert it to a chainable
  getters
    .filter(function(property) { return callsAssert(property.get); })
    .forEach(function(property) {
      convertAssertionPropertyToChainMethod(property.name, property.get);
    });


  Assertion.addMethod('ensure', function() { return execDeferred(this); });


  // Hook new property creations
  chai.util.events.addEventListener("addProperty", function({ name, fn }) {
    convertAssertionPropertyToChainMethod(name, fn);
  })

  // Hook new method assertions
  chai.util.events.addEventListener("addMethod", function({ name }) {
    Assertion.overwriteMethod(name, function(_super) {
      return function() {
        var result = execDeferred(this);
        return _super.apply(result, arguments);
      };
    });
  })

  // Hook new chainable methods
  chai.util.events.addEventListener("addChainableMethod", function({ name }) {
    // When overwriting an existing property, don't patch it
    if(!Assertion.prototype.hasOwnProperty(name)) {
      Assertion.overwriteChainableMethod(name, function(_super) {
        return function() {
          // Method call of the chainable method
          var result = execDeferred(this);
          return _super.apply(result, arguments);
        };
      }, function(_super) {
        return function() {
          // Getter of chainable method
          defer(this, _super);
          return this;
        };
      });
    }
  })
}
