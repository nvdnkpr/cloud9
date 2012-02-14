/**
 * Show a split view; two editors next to each other in one tab
 *
 * @copyright 2010, Ajax.org B.V.
 * @author Mike de Boer <mike AT c9 DOT io>
 * @license GPLv3 <http://www.gnu.org/licenses/gpl.txt>
 */

define(function(require, exports, module) {

var ide = require("core/ide");
var ext = require("core/ext");
var css = require("text!ext/splitview/splitview.css");
var Editors = require("ext/editors/editors");
var Tabbehaviors = require("ext/tabbehaviors/tabbehaviors");
var Settings = require("ext/settings/settings");
var Code = require("ext/code/code");

var Splits = require("ext/splitview/splits");

var EditSession = require("ace/edit_session").EditSession;

var mnuCloneView, mnuSplitAlign;

var restoring = false;
var restoreQueue = [];

module.exports = ext.register("ext/splitview/splitview", {
    name     : "Split View",
    dev      : "Ajax.org",
    alone    : true,
    type     : ext.GENERAL,
    
    commands : {
        "mergetableft": {hint: "Add the page on the left of the currently active page to a split view"},
        "mergetabright": {hint: "Add the page on the right of the currently active page to a split view"},
        "nexteditor": {hint: "Navigate to the next editor right or below the editor that is currently active in the current split view"},
        "preveditor": {hint: "Navigate to the previous editor left or above the editor that is currently active in the current split view"}
    },
    hotitems : [],
    nodes    : [],
    
    splits   : [],
    
    init : function(){
        apf.importCssString(css || "");
        
        var _self = this;
        var tabs = tabEditors; // localize global 'tabEditors'
        
        var parent = Tabbehaviors.menu;
        this.nodes.push(
            parent.appendChild(new apf.divider()),
            parent.appendChild(
                (mnuCloneView = new apf.item({
                    caption : "Clone Editor",
                    type    : "check",
                    checked : false,
                    onclick : function() {
                        if (this.checked)
                            _self.startCloneView(tabs.contextPage);
                        else
                            tabs.contextPage.close();
                    }
                }))
            ),
            parent.appendChild(
                (mnuSplitAlign = new apf.item({
                    caption : "Align Splits Vertically",
                    type    : "check",
                    checked : true,
                    onclick : function() {
                        _self.changeLayout(tabs.contextPage, this.checked ? "3rows" : "3cols");
                    }
                }))
            )
        );
        
        ide.addEventListener("editorswitch", function(e) {
            // the return value actually does something!
            return _self.updateSplitView(e.previousPage, e.nextPage);
        });
        
        ide.addEventListener("pageswitch", function(e) {
            if (!Splits.getActive())
                return;
            _self.save();
            
            if (typeof mnuSyntax == "undefined")
                return;
                
            var item;
            var syntax = mnuSyntax;
            var value = Code.getContentType(e.page.$model.data);
            for (var i = 0, l = syntax.childNodes.length; i < l; ++i) {
                item = syntax.childNodes[i];
                if (!item || !item.localName || item.localName != "item")
                    continue;
                if (item.value == value) {
                    item.select();
                    break;
                }
            }
        });
        
        ide.addEventListener("closefile", function(e) {
            _self.onFileClose(e);
        });
        
        ide.addEventListener("beforecycletab", function(e) {
            _self.onCycleTab(e);
        });
        
        function onAccessTabbing(e) {
            var split = Splits.get(e.page)[0];
            return !Splits.isActive(split);
        }
        
        ide.addEventListener("beforenexttab", function(e) {
            return onAccessTabbing(e);
        });
        
        ide.addEventListener("beforeprevioustab", function(e) {
            return onAccessTabbing(e);
        });
        
        ide.addEventListener("beforeclosetab", function(e) {
            var split = Splits.get(e.page)[0];
            if (!Splits.isActive(split))
                return;
            e.returnValue = split.pairs[split.activePage].page;
        });
        
        ide.addEventListener("correctactivepage", function(e) {
            var split = Splits.getActive();
            var editor = Editors.currentEditor && Editors.currentEditor.amlEditor;
            if (!split || !editor)
                return;
            var idx = Splits.indexOf(split, editor);
            if (idx == -1)
                return;
            e.returnValue = split.pairs[idx].page;
        });
        
        tabs.addEventListener("tabselectclick", function(e) {
            return _self.onTabClick(e);
        });
        
        tabs.addEventListener("tabselectmouseup", function(e) {
            var page = this.$activepage;
            var split = Splits.get(page)[0];
            if (split)
                Splits.update(split);
        });
        
        tabs.addEventListener("reorder", function(e) {
            Splits.get(e.page).forEach(function(split) {
                if (Splits.isActive(split))
                    Splits.update(split);
            });
            _self.save();
        });
        
        ide.addEventListener("loadsettings", function(e) {
            if (!e.model || !e.model.data)
                return;
            var data = e.model.data;
            ide.addEventListener("extload", function(){
                setTimeout(function() {
                    _self.restore(data);
                });
            });
        });
        
        ide.addEventListener("activepagemodel", function(e) {
            var page = tabs.getPage();
            var split = Splits.get(page)[0];
            if (!split || !Splits.isActive(split))
                return;
            
            e.returnValue = split.pairs[split.activePage || 0].page.$model;
        });
        
        ide.addEventListener("tab.create", function(e) {
            var page = e.page;
            var xmlNode = e.doc.getNode();
            if (!apf.isTrue(xmlNode.getAttribute("clone")))
                return;
            
            var id = page.id;
            var pages = tabs.getPages();
            var origPage;
            // loop to find 2nd tab.
            for (var i = 0, l = pages.length; i < l; ++i) {
                if (pages[i] !== page && pages[i].id == id) {
                    origPage = pages[i];
                    break;
                }
            }

            // if 2nd page found, join em!
            if (!origPage)
                return;
            
            //Splits.consolidateEditorSession(origPage, origPage.$editor.amlEditor);
            page.$doc = origPage.$doc;
            page.setAttribute("actiontracker", origPage.$at);
            page.$at = origPage.$at;
            
            // find the settings node that corresponds with the clone view
            // that is being constructed right now
            var settings, pages, indices, idx;
            if (Settings.model.data) {
                var nodes = Settings.model.data.selectNodes("splits/split");
                for (i = 0, l = nodes.length; i < l; ++i) {
                    pages = nodes[i] && nodes[i].getAttribute("pages");
                    if (!pages)
                        continue;
                    pages = pages.split(",");
                    indices = [];
                    idx = pages.indexOf(origPage.id);
                    while (idx != -1) {
                        indices.push(idx);
                        idx = pages.indexOf(origPage.id, idx + 1);
                    }
                    if (indices.length < 2)
                        continue;
                    settings = nodes[i];
                    break;
                }
            }
            if (settings && apf.isTrue(settings.getAttribute("active")))
                tabs.set(origPage);

            if (!page.$doc.acedoc)
                page.$doc.addEventListener("init", cont);
            else
                cont();
            
            function cont() {
                var editor = Splits.getCloneEditor(page);
                
                page.acesession = new EditSession(page.$doc.acedoc);
                page.acesession.setUndoManager(Splits.CloneUndoManager);
                
                page.$doc.addEventListener("prop.value", function(e) {
                    page.acesession.setValue(e.value || "");
                    editor.$editor.moveCursorTo(0, 0);
                });
                
                editor.setProperty("value", page.acesession);
                
                var split = Splits.create(origPage);
                split.clone = true;
                split.pairs.push({
                    page: page,
                    editor: editor
                });

                if (settings) {
                    var addPage;
                    for (i = 0, l = pages.length; i < l; ++i) {
                        if (pages[i] == origPage.id)
                            continue;
                        addPage = tabs.getPage(pages[i]);
                        if (!addPage || Splits.indexOf(split, addPage) > -1)
                            continue;
                        split.pairs.splice(i, 0, {
                            page: addPage,
                            editor: Splits.getEditor(split, addPage)
                        });
                    }
                    split.activePage = parseInt(settings.getAttribute("activepage"), 10) || 0;
                    split.gridLayout = settings.getAttribute("layout");
                }
                Splits.consolidateEditorSession(page, editor);

                page.addEventListener("DOMNodeRemovedFromDocument", function() {
                    _self.endCloneView(page);
                });

                origPage.addEventListener("DOMNodeRemovedFromDocument", function() {
                    _self.endCloneView(origPage);
                });

                if (restoreQueue.length) {
                    _self.restore(restoreQueue);
                }
                else {
                    Splits.show(split);
                    mnuCloneView.setAttribute("checked", true);
                    _self.save();
                }
            }
        });
        
        Splits.init(this);
    },
    
    mergetableft: function() {
        return this.mergeTab("left");
    },
    
    mergetabright: function() {
        return this.mergeTab("right");
    },
    
    mergeTab: function(dir) {
        var bRight   = dir == "right";
        var tabs     = tabEditors;
        var pages    = tabs.getPages();
        var curr     = tabs.getPage();
        var split    = Splits.getActive();
        var splitLen = split ? split.pairs.length : 0;
        if (split && Splits.indexOf(split, curr) > -1)
            curr = split.pairs[bRight ? splitLen - 1 : 0].page;
        if (!curr || pages.length == 1)
            return;
        
        var idx;
        if (splitLen == 3) {
            // if the max amount of tabs has been reached inside a split view,
            // then the user may remove the last or first tab from it.
            idx = pages.indexOf(split.pairs[bRight ? splitLen - 1 : 0].page);
        }
        else {
            var currIdx = pages.indexOf(curr);
            idx = currIdx + (bRight ? 1 : -1);
        }
        if (idx < 0 || idx > pages.length - 1)
            return;

        // enable split view ONLY for code editors for now...
        if (!this.isSupportedEditor(curr.$editor, pages[idx].$editor))
            return;
        // pass in null to mutate the active split view
        Splits.mutate(null, pages[idx]);
        Splits.update();
        this.save();
        return false;
    },
    
    nexteditor: function() {
        this.cycleEditors("next");
    },
    
    preveditor: function() {
        this.cycleEditors("prev");
    },
    
    cycleEditors: function(dir) {
        var split = Splits.getActive();
        if (!split)
            return;

        var bNext   = dir == "next";
        var currIdx = split.activePage;
        var idx     = currIdx + (bNext ? 1 : -1);
        if (idx < 0)
            idx = split.pairs.length - 1;
        if (idx > split.pairs.length - 1)
            idx = 0;

        Splits.setActivePage(split, split.pairs[idx].page);
        return false;
    },
    
    /**
     * Invoked when a file is closed
     *
     * @param {AmlEvent} e
     */
    onFileClose: function(e) {
        var page = e.page;
        var splits = Splits.get(page);
        for (var i = 0, l = splits.length; i < l; ++i)
            Splits.mutate(splits[i], page);
        Splits.update();
        this.save();
    },
    
    /**
     * Invoked when a tab is clicked, that is the part of the tab-button that is NOT
     * a close button.
     * 
     * @param {AmlEvent} e
     */
    onTabClick: function(e) {
        var page = e.page;
        var tabs = tabEditors;
        var activePage = tabs.getPage();
        var shiftKey = e.htmlEvent.shiftKey;
        var ret = null;
        var split = Splits.get(activePage)[0];

        if (split && !shiftKey) {
            for (var i = 0, l = split.pairs.length; i < l; ++i) {
                if (split.pairs[i].page !== activePage)
                    continue;
                ret = false;
                break;
            }
            Splits.setActivePage(split, page);
            // only the first tab in the split view is the trigger to select all
            // other tabs as well (because only the page of the first tab is 
            // REALLY shown)
            if (ret !== false && page !== split.pairs[0].page) {
                tabs.set(split.pairs[0].page);
                ret = false;
            }
            
            if (!shiftKey)
                return true;

            return ret;
        }
        else if (shiftKey) {
            // enable split view ONLY for code editors for now...
            if (!this.isSupportedEditor(activePage.$editor, page.$editor))
                return;
            // tabs can be merged into and unmerged from a splitview by clicking a
            // tab while holding shift
            //console.log("is clone?",apf.isTrue(page.$doc.getNode().getAttribute("clone")));
            if (apf.isTrue(page.$doc.getNode().getAttribute("clone"))) {
                tabs.remove(page, null, true);
                ret = false;
            }
            else {
                ret = !Splits.mutate(split, page);
                this.save();
            }
            return ret;
        }
    },
    
    /**
     * Tab cycling is handled by the tabbehaviors extension, which emits an event
     * we can hook into. We correct the tab to switch to if a user lands onto a
     * split view while cycling.
     * 
     * @param {AmlEvent} e
     */
    onCycleTab: function(e) {
        var pages  = e.pages;
        var split = Splits.getActive();
        if (!split)
            return;
        if (split.pairs.length == pages.length)
            return (e.returnValue = false);
        
        var maxIdx = pages.length - 1;
        var bRight = e.dir == "right";
        var idx = pages.indexOf(split.pairs[bRight ? split.pairs.length - 1 : 0].page) + (bRight ? 1 : -1);
        idx = idx < 0 ? maxIdx : idx > maxIdx ? 0 : idx;
        if (Splits.indexOf(split, pages[idx]) > -1)
            return (e.returnValue = false);
        
        // check if the next tab is inside a split as well:
        split = Splits.get(pages[idx])[0];
        if (split)
            e.returnValue = pages.indexOf(split.pairs[0].page);
        else
            e.returnValue = idx;
    },
    
    updateSplitView: function(previous, next) {
        //if (restoring)
        //    return;
        var editor;
        var doc = next.$doc;
        var at  = next.$at;
        // check if this is a valid clone session
        var split = Splits.get(next)[0];
        
        // hide the previous split view
        if (previous && previous.$model) {
            var oldSplit = Splits.get(previous)[0];
            if (oldSplit && (!split || oldSplit.gridLayout != split.gridLayout))
                Splits.hide(oldSplit);
        }
        
        // enable split view ONLY for code editors for now...
        if (this.isSupportedEditor(next.$editor)) {
            mnuCloneView.enable();
            mnuSplitAlign.enable();
        }
        else {
            mnuCloneView.disable();
            mnuSplitAlign.disable();
        }
        
        mnuCloneView.setAttribute("checked", false);
        mnuSplitAlign.setAttribute("checked", false);

        // all this must exist
        if (!doc || !at || !split) {
            // if it doesn't, make sure the editor is visible and correctly displayed
            editor = next.$editor.amlEditor;
            if (!editor)
                return;
            Splits.consolidateEditorSession(next, editor);
            var nextPage = next.fake ? next.relPage : next;
            if (editor.parentNode != nextPage)
                nextPage.appendChild(editor);
            editor.show();
            return;
        }

        Splits.show(split);
        mnuSplitAlign.setAttribute("checked", split.gridLayout == "3rows");
        
        if (split.clone)
            mnuCloneView.setAttribute("checked", true);
        
        apf.layout.forceResize();
        
        this.save();
        
        return false;
    },
    
    changeLayout: function(page, gridLayout) {
        var split = Splits.get(page)[0];
        if (!split || split.gridLayout == gridLayout)
            return;
        
        Splits.update(split, gridLayout);
        mnuSplitAlign.setAttribute("checked", gridLayout == "3rows");
        this.save();
    },
    
    /**
     * 
     */
    startCloneView: function(page) {
        var split = this.getCloneView(page);
        var doc  = page.$doc;
        
        if (split || !doc || !Splits.getEditorSession(page))
            return;

        apf.xmldb.setAttribute(doc.getNode(), "clone", true);
        Editors.openEditor(doc, false, false, true);
    },
    
    endCloneView: function(page) {
        mnuCloneView.setAttribute("checked", false);
        var split = this.getCloneView(page);
        if (!split)
            return;

        delete split.clone;
        apf.xmldb.setAttribute(page.$doc.getNode(), "clone", false);
    },
    
    getCloneView: function(page) {
        var splits = Splits.get(page);
        if (!splits.length)
            return null;

        for (var i = 0, l = splits.length; i < l; ++i) {
            if (splits[i] && splits[i].clone)
                return splits[i];
        }
        return null;
    },
    
    save: function() {
        if (!Settings.model || restoring)
            return;

        var node = apf.createNodeFromXpath(Settings.model.data, "splits");
        var i, l;
        for (i = node.childNodes.length - 1; i >= 0; --i)
            node.removeChild(node.childNodes[i]);
        
        var splits = Splits.get();
        var splitEl;
        for (i = 0, l = splits.length; i < l; ++i) {
            splitEl = apf.getXml("<split />");
            splitEl.setAttribute("pages", splits[i].pairs.map(function(pair) {
                return pair.page.id;
            }).join(","));
            splitEl.setAttribute("active", Splits.isActive(splits[i]) ? "true" : "false");
            splitEl.setAttribute("activepage", splits[i].activePage + "");
            splitEl.setAttribute("layout", splits[i].gridLayout);
            node.appendChild(splitEl);
        }
        apf.xmldb.applyChanges("synchronize", node);
    },
    
    restore: function(settings) {
        // no tabs open... don't bother ;)
        var tabs = tabEditors;
        if (tabs.getPages().length <= 1)
            return;
        
        var nodes;
        var splits = Splits.get();
        if (apf.isArray(settings))
            nodes = settings;
        else
            nodes = settings.selectNodes("splits/split");
        
        if (!nodes || !nodes.length)
            return;
        
        restoring = true;
        var activePage = tabs.getPage();
        
        var node, ids, j, l2, id, dupes, hasClone, split, page, editor, active;
        for (var i = nodes.length - 1; i >= 0; --i) {
            node = nodes.pop();
            ids = node.getAttribute("pages").split(",");

            hasClone = false;
            dupes = {};
            for (j = 0, l2 = ids.length; j < l2; ++j) {
                id = ids[j];
                if (!dupes[id]) {
                    dupes[id] = 1;
                }
                else {
                    dupes[id]++;
                    hasClone = id;
                }
            }
            
            ids = Object.keys(dupes);
            l2 = ids.length;
            if (l2 < 2)
                continue;
            
            if (hasClone) {
                page = tabs.getPage(hasClone);
                if (!page)
                    continue;
                if (!page.$doc.acesession) {
                    if (restoreQueue.indexOf(node) == -1)
                        restoreQueue.push(node);
                    continue;
                }
                else {
                    split = this.getCloneView(page);
                    if (!split) {
                        if (restoreQueue.indexOf(node) == -1)
                            restoreQueue.push(node);
                        continue;
                    }
                }
            }
            else {
                split = {
                    pairs: [],
                    gridLayout: node.getAttribute("layout") || null
                };
            }

            split.activePage = parseInt(node.getAttribute("activepage"), 10)
            if (split.activePage < 0)
                split.activePage = 0;

            for (j = 0; j < l2; ++j) {
                id = ids[j];
                if (id == hasClone)
                    continue;
                page = tabs.getPage(id);
                if (!page || Splits.indexOf(split, page) > -1)
                    continue;
                editor = Splits.getEditor(split, page);
                split.pairs.push({
                    page: page,
                    editor: editor
                });
            }
            
            if (split.pairs.length > 1) {
                if (apf.isTrue(node.getAttribute("active")))
                    active = split;
                if (splits.indexOf(split) == -1)
                    splits.push(split);
            }
        }
        Splits.set(splits);
        
        if (!active || Splits.indexOf(active, activePage) == -1) {
            tabs.set(activePage);
        }
        else if (active) {
            //tabs.set(active.pairs[0].page);
            Splits.update(active);
            Splits.show(active);
            mnuSplitAlign.setAttribute("checked", active.gridLayout == "3rows");
            if (active.clone)
                mnuCloneView.setAttribute("checked", true);
        }

        if (!restoreQueue.length)
            restoring = false;
    },
    
    isSupportedEditor: function() {
        var editor;
        for (var i = 0, l = arguments.length; i < l; ++i) {
            editor = arguments[i];
            if (!editor || !editor.name || editor.name.indexOf("Code Editor") == -1)
                return false;
        }
        return true;
    },
    
    enable : function(){
        this.nodes.each(function(item){
            item.enable();
        });
    },

    disable : function(){
        this.nodes.each(function(item){
            item.disable();
        });
    },

    destroy : function(){
        this.nodes.each(function(item){
            item.destroy(true, true);
        });
        this.nodes = [];
    }
});

});