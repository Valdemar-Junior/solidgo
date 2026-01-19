import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Check, ChevronDown, X, Search } from 'lucide-react';

interface MultiSelectProps {
    options: string[];
    selected: string[];
    onChange: (selected: string[]) => void;
    placeholder?: string;
    label?: string;
    className?: string;
    disabled?: boolean;
}

export function MultiSelect({
    options,
    selected,
    onChange,
    placeholder = 'Selecione...',
    label,
    className = '',
    disabled = false
}: MultiSelectProps) {
    const [isOpen, setIsOpen] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const containerRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    // Close dropdown when clicking outside
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    // Filter options based on search term
    const filteredOptions = useMemo(() => {
        return options.filter(option =>
            option.toLowerCase().includes(searchTerm.toLowerCase())
        );
    }, [options, searchTerm]);

    const handleSelect = (option: string) => {
        if (selected.includes(option)) {
            onChange(selected.filter(item => item !== option));
        } else {
            onChange([...selected, option]);
        }
    };

    const handleSelectAll = () => {
        if (filteredOptions.every(option => selected.includes(option))) {
            // If all filtered options are already selected, deselect them
            onChange(selected.filter(item => !filteredOptions.includes(item)));
        } else {
            // Select all filtered options (add missing ones)
            const newSelected = [...selected];
            filteredOptions.forEach(option => {
                if (!newSelected.includes(option)) {
                    newSelected.push(option);
                }
            });
            onChange(newSelected);
        }
    };

    const removeOption = (e: React.MouseEvent, option: string) => {
        e.stopPropagation();
        onChange(selected.filter(item => item !== option));
    };

    const clearSelection = (e: React.MouseEvent) => {
        e.stopPropagation();
        onChange([]);
    };

    const isAllSelected = filteredOptions.length > 0 && filteredOptions.every(option => selected.includes(option));

    return (
        <div className={`relative ${className}`} ref={containerRef}>
            {label && (
                <label className="block text-sm font-medium text-gray-700 mb-1">
                    {label}
                </label>
            )}

            <div
                className={`
          min-h-[38px] w-full border rounded-lg bg-white px-3 py-1.5 flex items-center justify-between cursor-pointer
          ${disabled ? 'opacity-50 cursor-not-allowed bg-gray-50' : 'hover:border-blue-500'}
          ${isOpen ? 'ring-2 ring-blue-500 border-transparent' : 'border-gray-300'}
        `}
                onClick={() => !disabled && setIsOpen(!isOpen)}
            >
                <div className="flex flex-wrap gap-1 items-center overflow-hidden">
                    {selected.length === 0 ? (
                        <span className="text-gray-400">{placeholder}</span>
                    ) : (
                        selected.length <= 2 ? (
                            selected.map(item => (
                                <span key={item} className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium bg-blue-100 text-blue-800 border border-blue-200">
                                    {item}
                                    <span
                                        role="button"
                                        className="ml-1 hover:text-blue-900 focus:outline-none"
                                        onClick={(e) => removeOption(e, item)}
                                    >
                                        <X className="h-3 w-3" />
                                    </span>
                                </span>
                            ))
                        ) : (
                            <div className="flex items-center gap-1">
                                <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium bg-blue-100 text-blue-800 border border-blue-200">
                                    {selected.length} items
                                </span>
                                <span onClick={clearSelection} className="text-xs text-gray-500 hover:text-red-500 z-10 p-1">
                                    <X className="h-3 w-3" />
                                </span>
                            </div>
                        )
                    )}
                </div>

                <div className="flex items-center ml-2 text-gray-400">
                    {/* If more than 2 items selected show clear all X, otherwise just arrow */}
                    {/* Actually chevron is always good */}
                    <ChevronDown className={`h-4 w-4 transition-transform ${isOpen ? 'transform rotate-180' : ''}`} />
                </div>
            </div>

            {isOpen && (
                <div className="absolute z-50 mt-1 w-full bg-white shadow-lg max-h-60 rounded-lg py-1 text-base ring-1 ring-black ring-opacity-5 overflow-auto focus:outline-none sm:text-sm">
                    <div className="sticky top-0 bg-white p-2 border-b z-10">
                        <div className="relative">
                            <Search className="absolute left-2 top-2.5 h-4 w-4 text-gray-400" />
                            <input
                                ref={inputRef}
                                type="text"
                                className="w-full pl-8 pr-3 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                                placeholder="Buscar..."
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                onClick={(e) => e.stopPropagation()}
                            />
                        </div>
                        {filteredOptions.length > 0 && (
                            <div
                                className="flex items-center px-2 py-2 mt-2 hover:bg-gray-100 cursor-pointer rounded-md"
                                onClick={handleSelectAll}
                            >
                                <div className={`
                   flex items-center justify-center w-4 h-4 border rounded mr-2
                   ${isAllSelected ? 'bg-blue-600 border-blue-600' : 'border-gray-300 bg-white'}
                 `}>
                                    {isAllSelected && <Check className="h-3 w-3 text-white" />}
                                </div>
                                <span className="font-medium text-gray-900">Selecionar Todos</span>
                            </div>
                        )}
                    </div>

                    <div className="pt-1">
                        {filteredOptions.length === 0 ? (
                            <div className="px-4 py-2 text-sm text-gray-500 text-center">
                                Nenhum resultado encontrado
                            </div>
                        ) : (
                            filteredOptions.map((option) => {
                                const isSelected = selected.includes(option);
                                return (
                                    <div
                                        key={option}
                                        className={`
                      cursor-pointer select-none relative py-2 pl-3 pr-9 hover:bg-blue-50 transition-colors
                      ${isSelected ? 'bg-blue-50' : ''}
                    `}
                                        onClick={() => handleSelect(option)}
                                    >
                                        <div className="flex items-center">
                                            <div className={`
                         flex items-center justify-center w-4 h-4 border rounded mr-3
                         ${isSelected ? 'bg-blue-600 border-blue-600' : 'border-gray-300 bg-white'}
                       `}>
                                                {isSelected && <Check className="h-3 w-3 text-white" />}
                                            </div>
                                            <span className={`block truncate ${isSelected ? 'font-medium text-blue-900' : 'text-gray-900'}`}>
                                                {option}
                                            </span>
                                        </div>
                                    </div>
                                );
                            })
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
