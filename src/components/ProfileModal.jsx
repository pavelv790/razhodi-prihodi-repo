import { useState } from "react";
import { User, Plus, Check, X, Trash2, Edit2, Download } from "lucide-react";

const ProfileModal = ({ profiles, activeProfileId, onSwitch, onCreate, onDelete, onRename, onClose, onOpenMerge }) => {
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [createError, setCreateError] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState("");
  const [editError, setEditError] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);

  const handleCreate = async () => {
    const trimmed = newName.trim();
    if (!trimmed) { setCreateError("Въведи име на профила."); return; }
    const result = await onCreate(trimmed);
    if (!result) { setCreateError("Профил с това име вече съществува."); return; }
    setNewName("");
    setShowCreate(false);
    setCreateError("");
    handleSwitch(result.id);
  };

  const handleRename = async (id) => {
    const trimmed = editName.trim();
    if (!trimmed) { setEditError("Въведи име."); return; }
    const ok = await onRename(id, trimmed);
    if (!ok) { setEditError("Профил с това име вече съществува."); return; }
    setEditingId(null);
    setEditName("");
    setEditError("");
  };

  const handleSwitch = (id) => {
    onSwitch(id);
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-blue-50 rounded-2xl shadow-xl w-full max-w-sm">

        {/* Header */}
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <User className="w-4 h-4 text-gray-500" />
            <h2 className="text-base font-semibold text-gray-700">Профили</h2>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Profile list */}
        <div className="px-5 py-4 space-y-2 max-h-72 overflow-y-auto">
          {profiles.map((p) => (
            <div key={p.id} className={`rounded-xl border transition ${p.id === activeProfileId ? "border-blue-300 bg-blue-100" : "border-gray-200 bg-white"}`}>
              {editingId === p.id ? (
                <div className="px-3 py-2 space-y-2">
                  <input
                    autoFocus
                    value={editName}
                    onChange={(e) => { setEditName(e.target.value); setEditError(""); }}
                    onKeyDown={(e) => { if (e.key === "Enter") handleRename(p.id); if (e.key === "Escape") { setEditingId(null); setEditError(""); } }}
                    className="w-full px-3 py-1.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:border-blue-400"
                    placeholder="Ново име..."
                  />
                  {editError && <p className="text-xs text-red-500">{editError}</p>}
                  <div className="flex gap-2">
                    <button onClick={() => handleRename(p.id)} className="flex items-center gap-1 px-3 py-1 rounded-lg text-xs font-medium bg-blue-500 text-white hover:bg-blue-600 transition">
                      <Check className="w-3 h-3" /> Запази
                    </button>
                    <button onClick={() => { setEditingId(null); setEditError(""); }} className="flex items-center gap-1 px-3 py-1 rounded-lg text-xs font-medium bg-gray-100 text-gray-600 hover:bg-gray-200 transition">
                      <X className="w-3 h-3" /> Откажи
                    </button>
                  </div>
                </div>
              ) : confirmDeleteId === p.id ? (
                <div className="px-3 py-2 space-y-2">
                  <p className="text-xs text-red-600 font-medium">⚠️ Изтриване на „{p.name}"? Всички транзакции на този профил ще бъдат изтрити!</p>
                  <div className="flex gap-2">
                    <button onClick={() => { onDelete(p.id); setConfirmDeleteId(null); }} className="flex items-center gap-1 px-3 py-1 rounded-lg text-xs font-medium bg-red-500 text-white hover:bg-red-600 transition">
                      <Trash2 className="w-3 h-3" /> Да, изтрий
                    </button>
                    <button onClick={() => setConfirmDeleteId(null)} className="flex items-center gap-1 px-3 py-1 rounded-lg text-xs font-medium bg-gray-100 text-gray-600 hover:bg-gray-200 transition">
                      <X className="w-3 h-3" /> Откажи
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-between px-3 py-2.5">
                  <button onClick={() => handleSwitch(p.id)} className="flex items-center gap-2 flex-1 text-left">
                    <User className={`w-4 h-4 ${p.id === activeProfileId ? "text-blue-500" : "text-gray-400"}`} />
                    <span className={`text-sm font-medium ${p.id === activeProfileId ? "text-blue-700" : "text-gray-700"}`}>{p.name}</span>
                    {p.id === activeProfileId && <span className="text-xs text-blue-500 bg-blue-100 px-2 py-0.5 rounded-full">активен</span>}
                  </button>
                  <div className="flex items-center gap-1">
                    <button onClick={() => { setEditingId(p.id); setEditName(p.name); setEditError(""); }} className="p-1.5 rounded-lg text-gray-400 hover:text-blue-500 hover:bg-blue-50 transition">
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                    {profiles.length > 1 && (
                      <button onClick={() => setConfirmDeleteId(p.id)} className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Create new profile */}
        <div className="px-5 pb-5 border-t border-gray-100 pt-3">
          {showCreate ? (
            <div className="space-y-2">
              <input
                autoFocus
                value={newName}
                onChange={(e) => { setNewName(e.target.value); setCreateError(""); }}
                onKeyDown={(e) => { if (e.key === "Enter") handleCreate(); if (e.key === "Escape") { setShowCreate(false); setNewName(""); setCreateError(""); } }}
                className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-blue-400"
                placeholder="Име на новия профил..."
              />
              {createError && <p className="text-xs text-red-500">{createError}</p>}
              <div className="flex gap-2">
                <button onClick={handleCreate} className="flex items-center gap-1 px-4 py-2 rounded-xl text-sm font-medium bg-blue-500 text-white hover:bg-blue-600 transition">
                  <Check className="w-4 h-4" /> Създай
                </button>
                <button onClick={() => { setShowCreate(false); setNewName(""); setCreateError(""); }} className="flex items-center gap-1 px-4 py-2 rounded-xl text-sm font-medium bg-gray-100 text-gray-600 hover:bg-gray-200 transition">
                  <X className="w-4 h-4" /> Откажи
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <button onClick={() => setShowCreate(true)} className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium bg-green-50 text-green-600 hover:bg-green-100 transition">
                <Plus className="w-4 h-4" /> Създай нов профил
              </button>
              <button onClick={() => { onClose(); onOpenMerge(); }} className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium bg-blue-50 text-blue-600 hover:bg-blue-100 transition">
                <Download className="w-4 h-4" /> Импортирай данни от друг профил
              </button>
            </div>
          )}
        </div>

      </div>
    </div>
  );
};

export default ProfileModal;